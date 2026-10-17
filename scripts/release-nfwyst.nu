#!/usr/bin/env nu

const package_name = "@nfwyst/pinets"
const cli_package_name = "@nfwyst/pinets-cli"
const registry_url = "https://registry.npmjs.org"
const release_tag = "latest"
const registry_visibility_attempts = 150
const registry_visibility_delay = 2sec
const expected_remote = '^(?:https://github\.com/|ssh://git@github\.com/|git@github\.com:)nfwyst/PineTS(?:\.git)?$'
const cli_expected_remote = '^(?:https://github\.com/|ssh://git@github\.com/|git@github\.com:)nfwyst/pinets-cli(?:\.git)?$'
const git_name = "nfwyst"
const git_email = "35720450+nfwyst@users.noreply.github.com"
const release_files = ["package.json"]

def command-text [program: string, args: list<string>] {
    [$program] | append $args | str join " "
}

def capture-result [cwd: path, program: string, args: list<string>] {
    cd $cwd
    do --ignore-errors { run-external $program ...$args } | complete
}

def capture-command [cwd: path, program: string, args: list<string>] {
    let result = (capture-result $cwd $program $args)
    if $result.exit_code != 0 {
        let details = ($"($result.stderr)\n($result.stdout)" | str trim)
        error make $"Command failed: (command-text $program $args)\n($details)"
    }
    $result.stdout | str trim
}

def run-command [cwd: path, program: string, args: list<string>] {
    print $"→ (command-text $program $args)"
    cd $cwd
    run-external $program ...$args
}

def require-tools [] {
    for tool in ["bun" "bunx" "git" "mktemp" "nu" "tar"] {
        if (which $tool | is-empty) {
            error make $"Required command is unavailable: ($tool)"
        }
    }
}

def package-manifest [repo: path] {
    let path = ($repo | path join "package.json")
    if not ($path | path exists) {
        error make $"Missing package.json: ($path)"
    }
    open $path
}

def require-bun-version [repo: path] {
    let declared = (package-manifest $repo | get --optional packageManager | default "")
    if not ($declared =~ '^bun@[0-9]+\.[0-9]+\.[0-9]+$') {
        error make $"Invalid packageManager declaration in ($repo): ($declared)"
    }
    let expected = ($declared | str replace 'bun@' '')
    let actual = (capture-command $repo "bun" ["--version"])
    if $actual != $expected {
        error make $"Bun version mismatch in ($repo): expected ($expected), found ($actual)"
    }
}

def registry-token [] {
    let existing = ($env.NPM_CONFIG_TOKEN? | default "" | str trim)
    if not ($existing | is-empty) {
        return $existing
    }

    let npmrc = ($nu.home-dir | path join ".npmrc")
    if not ($npmrc | path exists) {
        error make $"Missing registry credentials file: ($npmrc)"
    }
    let matches = (
        open --raw $npmrc
        | lines
        | parse --regex '^//registry\.npmjs\.org/:_authToken=(?<token>.+)$'
    )
    if ($matches | is-empty) {
        error make "registry.npmjs.org authentication is missing; log in before releasing"
    }
    let token = ($matches | first | get token | str trim)
    if ($token | is-empty) {
        error make "npmjs authentication token is empty"
    }
    $token
}

def require-clean [repo: path] {
    let status = (capture-command $repo "git" ["status" "--porcelain=v1" "--untracked-files=all"])
    if not ($status | is-empty) {
        error make $"Repository must be clean before release: ($repo)\n($status)"
    }
}

def require-repo [repo: path, expected_name: string, remote_pattern: string] {
    let manifest = (package-manifest $repo)
    if $manifest.name != $expected_name {
        error make $"Expected ($expected_name), found ($manifest.name) in ($repo)"
    }

    require-clean $repo

    let branch = (capture-command $repo "git" ["branch" "--show-current"])
    if $branch != "main" {
        error make $"Release must run from main, found: ($branch)"
    }

    let remote = (capture-command $repo "git" ["remote" "get-url" "origin"])
    if not ($remote =~ $remote_pattern) {
        error make $"Unexpected origin remote: ($remote)"
    }

    let upstream = (capture-command $repo "git" ["rev-parse" "--abbrev-ref" "--symbolic-full-name" "@{u}"])
    if $upstream != "origin/main" {
        error make $"Expected upstream origin/main, found: ($upstream)"
    }

    run-command $repo "git" ["fetch" "origin" "main"]
    let counts = (
        capture-command $repo "git" ["rev-list" "--left-right" "--count" "HEAD...origin/main"]
        | split row --regex '\s+'
    )
    let behind = ($counts | get 1 | into int)
    if $behind > 0 {
        error make $"Local main is behind origin/main by ($behind) commit(s); fast-forward it first"
    }
}

def next-fork-version [current: string] {
    let rows = (
        $current
        | parse --regex '^(?<base>[0-9]+\.[0-9]+\.[0-9]+)-nfwyst\.(?<revision>[0-9]+)$'
    )
    if ($rows | is-empty) {
        error make $"Version must match <semver>-nfwyst.<number>: ($current)"
    }
    let row = ($rows | first)
    let revision = (($row.revision | into int) + 1)
    $"($row.base)-nfwyst.($revision)"
}

def require-fork-version [value: string] {
    if not ($value =~ '^[0-9]+\.[0-9]+\.[0-9]+-nfwyst\.[0-9]+$') {
        error make $"Version must match <semver>-nfwyst.<number>: ($value)"
    }
}

def registry-info [name: string, version: string] {
    let spec = $"($name)@($version)"
    let result = (capture-result $env.PWD "bun" ["info" "--no-cache" $"--registry=($registry_url)" $spec "--json"])
    if $result.exit_code == 0 {
        return { published: true, data: ($result.stdout | from json) }
    }
    let details = ($"($result.stderr)\n($result.stdout)" | str trim)
    if ($details =~ '(?i)No matching version found|404 Not Found|Not Found') {
        return { published: false, data: null }
    }
    error make $"Unable to query the package registry for ($spec):\n($details)"
}

def verify-published [name: string, version: string, expected_head: string] {
    for attempt in 1..$registry_visibility_attempts {
        let info = (registry-info $name $version)
        if $info.published {
            let actual_version = ($info.data | get version)
            let actual_head = ($info.data | get --optional gitHead)
            if $actual_version != $version {
                error make $"Registry returned unexpected version: ($actual_version)"
            }
            if $actual_head != $expected_head {
                error make $"Registry gitHead mismatch: expected ($expected_head), found ($actual_head)"
            }
            return
        }
        if $attempt < $registry_visibility_attempts {
            sleep $registry_visibility_delay
        }
    }
    error make $"Published package did not become visible: ($name)@($version)"
}

def require-published-head [name: string, version: string, info: record, expected_head: string] {
    if not $info.published {
        return
    }
    let actual_head = ($info.data | get --optional gitHead)
    if $actual_head != $expected_head {
        error make $"Published gitHead mismatch for ($name)@($version): expected ($expected_head), found ($actual_head)"
    }
}

def changed-paths [repo: path] {
    let result = (capture-result $repo "git" ["status" "--porcelain=v1" "--untracked-files=all"])
    if $result.exit_code != 0 {
        let details = ($"($result.stderr)\n($result.stdout)" | str trim)
        error make $"Unable to read repository status:\n($details)"
    }
    if ($result.stdout | str trim | is-empty) {
        return []
    }
    $result.stdout | lines | each {|line| $line | str replace --regex '^.. ' '' }
}

def require-only-release-files [repo: path] {
    let paths = (changed-paths $repo)
    let unexpected = ($paths | where {|path| not ($path in $release_files) })
    if not ($unexpected | is-empty) {
        error make $"Unexpected files changed during release:\n($unexpected | str join '\n')"
    }
}

def require-staged-release-files [repo: path] {
    let staged_text = (capture-command $repo "git" ["diff" "--cached" "--name-only"])
    let staged = if ($staged_text | is-empty) { [] } else { $staged_text | lines | sort }
    if $staged != ($release_files | sort) {
        error make $"Only ($release_files | str join ', ') may be staged; found: ($staged | str join ', ')"
    }
}

def commit-release [repo: path, version: string] {
    run-command $repo "git" ["add" "--" ...$release_files]
    require-staged-release-files $repo

    let message = $"Release ($package_name) ($version)"
    with-env {
        TRAE_GIT_ATTRIBUTION_HELPER: ""
        GIT_AUTHOR_NAME: $git_name
        GIT_AUTHOR_EMAIL: $git_email
        GIT_COMMITTER_NAME: $git_name
        GIT_COMMITTER_EMAIL: $git_email
    } {
        run-command $repo "git" [
            "-c" $"user.name=($git_name)"
            "-c" $"user.email=($git_email)"
            "commit" "-m" $message
        ]
    }

    let committed_message = (capture-command $repo "git" ["log" "-1" "--format=%B"])
    if ($committed_message =~ '(?im)^(Co-authored-by|Generated-by|Assisted-by|Signed-off-by):|TRAE CLI') {
        error make "Forbidden attribution found in the release commit"
    }

    let author = (capture-command $repo "git" ["log" "-1" "--format=%an <%ae>"])
    let committer = (capture-command $repo "git" ["log" "-1" "--format=%cn <%ce>"])
    let expected_identity = $"($git_name) <($git_email)>"
    if $author != $expected_identity or $committer != $expected_identity {
        error make $"Unexpected Git identity: author=($author), committer=($committer)"
    }
}

def create-release-archive [repo: path, version: string, expected_head: string] {
    let staging = (mktemp --directory --tmpdir $"pinets-release.XXXXXX")
    cp ($repo | path join "package.json") $staging
    cp ($repo | path join "LICENSE") $staging
    cp ($repo | path join "README.md") $staging
    cp ($repo | path join "CHANGELOG.md") $staging
    cp --recursive ($repo | path join "dist") $staging

    let staged_manifest_path = ($staging | path join "package.json")
    open $staged_manifest_path
        | upsert gitHead $expected_head
        | to json --indent 4
        | save --force $staged_manifest_path

    print $"→ bun pm pack --ignore-scripts --quiet --destination ($staging)"
    let pack = (capture-result $staging "bun" ["pm" "pack" "--ignore-scripts" "--quiet" "--destination" $staging])
    if $pack.exit_code != 0 {
        rm --recursive --force $staging
        let details = ($"($pack.stderr)\n($pack.stdout)" | str trim)
        error make $"Unable to create release archive:\n($details)"
    }

    let archive = ($staging | path join ($pack.stdout | str trim | path basename))
    let packed_manifest_result = (capture-result $staging "tar" ["-xOf" $archive "package/package.json"])
    if $packed_manifest_result.exit_code != 0 {
        rm --recursive --force $staging
        error make $"Unable to inspect release archive: ($packed_manifest_result.stderr | str trim)"
    }
    let packed_manifest = ($packed_manifest_result.stdout | from json)
    let packed_version = ($packed_manifest | get version | into string)
    let packed_head = ($packed_manifest | get --optional gitHead)
    if $packed_version != $version or $packed_head != $expected_head {
        rm --recursive --force $staging
        error make $"Release archive provenance mismatch: version=($packed_version), gitHead=($packed_head)"
    }
    { directory: $staging, path: $archive }
}

def confirm-release [core_version: string, cli_version: string, yes: bool] {
    if $yes {
        return
    }
    let phrase = $"release ($package_name)@($core_version) and ($cli_package_name)@($cli_version)"
    let answer = (input $"Type '($phrase)' to continue: ")
    if $answer != $phrase {
        error make "Release cancelled"
    }
}

# Publish the nfwyst PineTS core, then delegate the CLI, global binary, and skill release.
export def main [
    --version: string      # Explicit core version; defaults to the next -nfwyst.N revision.
    --cli-version: string  # Explicit CLI version; defaults to the next -nfwyst.N revision.
    --cli-repo: path       # Override the sibling pinets-cli repository path.
    --resume               # Reuse the current core version after a partial release.
    --cli-resume           # Reuse the current CLI version after a partial release.
    --dry-run              # Run preflight checks and print the plan without releasing.
    --yes                  # Skip the typed release confirmation in both scripts.
] {
    require-tools

    let repo = ($env.PROCESS_PATH | path expand | path dirname | path dirname)
    let resolved_cli_repo = if ($cli_repo | is-empty) {
        $repo | path dirname | path join "pinets-cli"
    } else {
        $cli_repo | path expand
    }
    let cli_script = ($resolved_cli_repo | path join "scripts" "release-nfwyst.nu")

    require-repo $repo $package_name $expected_remote
    require-repo $resolved_cli_repo $cli_package_name $cli_expected_remote
    require-bun-version $repo
    require-bun-version $resolved_cli_repo
    if not ($cli_script | path exists) {
        error make $"Missing CLI release script: ($cli_script)"
    }

    let manifest = (package-manifest $repo)
    let cli_manifest = (package-manifest $resolved_cli_repo)
    let current_version = ($manifest.version | into string)
    let current_cli_version = ($cli_manifest.version | into string)
    let target_version = if not ($version | is-empty) {
        $version
    } else if $resume {
        $current_version
    } else {
        next-fork-version $current_version
    }
    let target_cli_version = if not ($cli_version | is-empty) {
        $cli_version
    } else if $cli_resume {
        $current_cli_version
    } else {
        next-fork-version $current_cli_version
    }

    require-fork-version $target_version
    require-fork-version $target_cli_version
    if $resume and $target_version != $current_version {
        error make $"--resume requires the current core version: ($current_version)"
    }
    if not $resume and $target_version == $current_version {
        error make "Use --resume to release the current core version"
    }
    if $cli_resume and $target_cli_version != $current_cli_version {
        error make $"--cli-resume requires the current CLI version: ($current_cli_version)"
    }
    if not $cli_resume and $target_cli_version == $current_cli_version {
        error make "Use --cli-resume to release the current CLI version"
    }

    let npmjs_token = (registry-token)
    let registry_user = (with-env { NPM_CONFIG_TOKEN: $npmjs_token } {
        capture-command $repo "bun" ["pm" $"--registry=($registry_url)" "whoami"]
    })

    let existing = (registry-info $package_name $target_version)
    if $existing.published and not $resume {
        error make $"Version is already published: ($package_name)@($target_version)"
    }
    if $resume {
        let current_head = (capture-command $repo "git" ["rev-parse" "HEAD"])
        require-published-head $package_name $target_version $existing $current_head
    }
    let existing_cli = (registry-info $cli_package_name $target_cli_version)
    if $existing_cli.published and not $cli_resume {
        error make $"Version is already published: ($cli_package_name)@($target_cli_version)"
    }
    if $cli_resume {
        let current_cli_head = (capture-command $resolved_cli_repo "git" ["rev-parse" "HEAD"])
        require-published-head $cli_package_name $target_cli_version $existing_cli $current_cli_head
    }

    print ""
    print "Release plan"
    print $"  PineTS:     ($current_version) → ($target_version)"
    print $"  pinets-cli: ($current_cli_version) → ($target_cli_version)"
    print $"  core repo:  ($repo)"
    print $"  CLI repo:   ($resolved_cli_repo)"
    print $"  registry user: ($registry_user)"
    print "  final:      global pinets + ~/.agents/skills/pinets"
    print ""

    if $dry_run {
        print "Dry run complete; no worktree, commit, push, publish, global CLI, or skill changes were made."
        return
    }

    confirm-release $target_version $target_cli_version $yes

    run-command $repo "bun" ["run" "test" "--run" "--maxWorkers=1" "--no-file-parallelism"]
    run-command $repo "bun" ["run" "build:prod:all"]
    require-clean $repo

    if $target_version != $current_version {
        run-command $repo "bun" ["pm" "pkg" "set" $"version=($target_version)"]
        run-command $repo "bun" ["install" "--frozen-lockfile" "--lockfile-only" $"--registry=($registry_url)"]
        require-only-release-files $repo
        commit-release $repo $target_version
    }

    let release_head = (capture-command $repo "git" ["rev-parse" "HEAD"])
    let prepush_published = (registry-info $package_name $target_version)
    require-published-head $package_name $target_version $prepush_published $release_head

    run-command $repo "git" ["push" "origin" "HEAD:main"]
    let published = (registry-info $package_name $target_version)
    if $published.published {
        require-published-head $package_name $target_version $published $release_head
        print $"Registry package already published; continuing toolchain release: ($package_name)@($target_version)"
    } else {
        let release_archive = (create-release-archive $repo $target_version $release_head)
        print $"→ bun publish --access=public --tag=($release_tag) --registry=($registry_url) ($release_archive.path)"
        try {
            with-env { NPM_CONFIG_TOKEN: $npmjs_token } {
                run-command $repo "bun" [
                    "publish"
                    "--access=public"
                    $"--tag=($release_tag)"
                    $"--registry=($registry_url)"
                    $release_archive.path
                ]
            }
        } catch {|error|
            rm --recursive --force $release_archive.directory
            error make { msg: $"Unable to publish ($package_name)@($target_version)" inner: [$error] }
        }
        rm --recursive --force $release_archive.directory
        verify-published $package_name $target_version $release_head
    }

    mut cli_args = [
        $cli_script
        "--version" $target_cli_version
        "--core-version" $target_version
        "--yes"
    ]
    if $cli_resume {
        $cli_args = ($cli_args | append "--resume")
    }
    run-command $resolved_cli_repo "nu" $cli_args

    print ""
    print $"Released the full nfwyst toolchain from ($package_name)@($target_version)."
}
