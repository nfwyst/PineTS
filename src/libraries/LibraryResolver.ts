// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

import type { LibraryImportRequest, LibraryResolver as ResolveLibrary } from '../types/PineTypes';

export type LibraryReference = {
    readonly user: string;
    readonly name: string;
    readonly version: number;
};

export function libraryKey(reference: LibraryReference): string {
    return `${reference.user}/${reference.name}/${reference.version}`;
}

/** Per-PineTS-instance source cache with exact-key in-flight de-duplication. */
export class LibrarySourceResolver {
    private readonly sources = new Map<string, string | undefined>();
    private readonly inFlight = new Map<string, Promise<string | undefined>>();

    constructor(private readonly resolveLibrary: ResolveLibrary | undefined) {}

    public get configured(): boolean {
        return this.resolveLibrary !== undefined;
    }

    public resolve(reference: LibraryReference, from: string): Promise<string | undefined> {
        const key = libraryKey(reference);
        if (this.sources.has(key)) return Promise.resolve(this.sources.get(key));

        const pending = this.inFlight.get(key);
        if (pending) return pending;
        if (!this.resolveLibrary) return Promise.resolve(undefined);

        const request: LibraryImportRequest = {
            user: reference.user,
            name: reference.name,
            version: String(reference.version),
            from,
        };
        const resolution = this.resolveLibrary(request)
            .then((source) => {
                this.sources.set(key, source);
                return source;
            })
            .finally(() => this.inFlight.delete(key));
        this.inFlight.set(key, resolution);
        return resolution;
    }
}
