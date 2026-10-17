// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

export type NamedBuiltinArgument<T> = {
    readonly name: string;
    readonly value: T;
};

type BuiltinSignature = {
    readonly parameters: readonly string[];
    readonly requiredCount: number;
    readonly variadic?: boolean;
};

type SignatureAttempt<T> = {
    readonly argumentsByIndex: readonly (T | undefined)[];
    readonly duplicateName: string | null;
    readonly missingNames: readonly string[];
};

const BUILTIN_SIGNATURES: Readonly<Record<string, readonly BuiltinSignature[]>> = {
    'ta.sma': [
        { parameters: ['source', 'length'], requiredCount: 2 },
    ],
    'ta.pivothigh': [
        { parameters: ['leftbars', 'rightbars'], requiredCount: 2 },
        { parameters: ['source', 'leftbars', 'rightbars'], requiredCount: 3 },
    ],
    'math.max': [
        { parameters: ['source', 'x'], requiredCount: 2, variadic: true },
    ],
};

class BuiltinNamedArgumentError extends SyntaxError {
    readonly name = 'BuiltinNamedArgumentError';
}

function duplicateArgument(functionName: string, argumentName: string): BuiltinNamedArgumentError {
    return new BuiltinNamedArgumentError(
        `Argument "${argumentName}" is supplied more than once in call to "${functionName}()".`,
    );
}

function attemptSignature<T>(
    signature: BuiltinSignature,
    positionalArguments: readonly T[],
    namedArguments: readonly NamedBuiltinArgument<T>[],
): SignatureAttempt<T> | null {
    if (!signature.variadic && positionalArguments.length > signature.parameters.length) return null;

    const slotCount = Math.max(signature.parameters.length, positionalArguments.length);
    const argumentsByIndex = new Array<T | undefined>(slotCount);
    positionalArguments.forEach((argument, index) => {
        argumentsByIndex[index] = argument;
    });

    let duplicateName: string | null = null;
    for (const argument of namedArguments) {
        const index = signature.parameters.indexOf(argument.name);
        if (index < 0) return null;
        if (index < positionalArguments.length || argumentsByIndex[index] !== undefined) {
            duplicateName ??= argument.name;
            continue;
        }
        argumentsByIndex[index] = argument.value;
    }

    const missingNames = signature.parameters
        .slice(0, signature.requiredCount)
        .filter((_name, index) => argumentsByIndex[index] === undefined);
    return { argumentsByIndex, duplicateName, missingNames };
}

function trimTrailingGaps<T>(argumentsByIndex: readonly (T | undefined)[]): Array<T | undefined> {
    let end = argumentsByIndex.length;
    while (end > 0 && argumentsByIndex[end - 1] === undefined) end--;
    return argumentsByIndex.slice(0, end);
}

/**
 * Reorder the trailing named-argument object emitted by the Pine parser into
 * the positional calling convention used by PineTS namespaces. Unregistered
 * built-ins keep their existing object-argument behavior.
 */
export function bindBuiltinNamedArguments<T>(
    functionName: string,
    positionalArguments: readonly T[],
    namedArguments: readonly NamedBuiltinArgument<T>[],
): readonly (T | undefined)[] | undefined {
    const signatures = BUILTIN_SIGNATURES[functionName];
    if (!signatures) return undefined;

    const seenNames = new Set<string>();
    for (const argument of namedArguments) {
        if (seenNames.has(argument.name)) throw duplicateArgument(functionName, argument.name);
        seenNames.add(argument.name);
    }

    const knownNames = new Set(signatures.flatMap((signature) => signature.parameters));
    const unknownArgument = namedArguments.find((argument) => !knownNames.has(argument.name));
    if (unknownArgument) {
        throw new BuiltinNamedArgumentError(
            `Unknown named argument "${unknownArgument.name}" in call to "${functionName}()". ` +
                `Expected one of: ${Array.from(knownNames).join(', ')}.`,
        );
    }

    const attempts = signatures
        .map((signature) => attemptSignature(signature, positionalArguments, namedArguments))
        .filter((attempt): attempt is SignatureAttempt<T> => attempt !== null);
    const viable = attempts.filter((attempt) => attempt.duplicateName === null);
    const complete = viable.filter((attempt) => attempt.missingNames.length === 0);

    if (complete.length === 1) return trimTrailingGaps(complete[0].argumentsByIndex);
    if (complete.length > 1 || (complete.length === 0 && viable.length > 1)) {
        throw new BuiltinNamedArgumentError(
            `Ambiguous overload for "${functionName}()" with arguments: ` +
                `${namedArguments.map((argument) => argument.name).join(', ')}.`,
        );
    }

    if (viable.length === 0) {
        const duplicateName = attempts.find((attempt) => attempt.duplicateName !== null)?.duplicateName;
        if (duplicateName) throw duplicateArgument(functionName, duplicateName);
    }

    if (viable.length === 1) {
        throw new BuiltinNamedArgumentError(
            `No matching overload for "${functionName}()". Missing required arguments: ` +
                `${viable[0].missingNames.join(', ')}.`,
        );
    }

    throw new BuiltinNamedArgumentError(
        `No matching overload for "${functionName}()" with the supplied arguments.`,
    );
}
