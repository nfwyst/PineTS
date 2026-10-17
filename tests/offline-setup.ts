// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, beforeEach, vi } from 'vitest';

const denyNetwork: typeof fetch = async () => {
    throw new Error('Network access is disabled in the deterministic test suite');
};

vi.stubGlobal('fetch', denyNetwork);

beforeEach(() => {
    vi.stubGlobal('fetch', denyNetwork);
});

afterEach(() => {
    vi.unstubAllGlobals();
});
