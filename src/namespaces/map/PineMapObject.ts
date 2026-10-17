// SPDX-License-Identifier: AGPL-3.0-only
// This file is auto-generated. Do not edit manually.
// Run: bun run generate:map-index

export class PineMapObject {
    public map: Map<any, any>;
    // 'string' for map<K, string>, whose missing keys read as the na string ("")
    public valueType?: string;
    constructor(public context: any) {
        this.map = new Map();
    }

    toString(): string {
        return `PineMapObject(${this.map.size})`;
    }

    clear(...args: any[]) {
        return this.context.pine.map.clear(this, ...args);
    }

    contains(...args: any[]) {
        return this.context.pine.map.contains(this, ...args);
    }

    copy(...args: any[]) {
        return this.context.pine.map.copy(this, ...args);
    }

    get(...args: any[]) {
        return this.context.pine.map.get(this, ...args);
    }

    keys(...args: any[]) {
        return this.context.pine.map.keys(this, ...args);
    }

    put(...args: any[]) {
        return this.context.pine.map.put(this, ...args);
    }

    put_all(...args: any[]) {
        return this.context.pine.map.put_all(this, ...args);
    }

    remove(...args: any[]) {
        return this.context.pine.map.remove(this, ...args);
    }

    size(...args: any[]) {
        return this.context.pine.map.size(this, ...args);
    }

    values(...args: any[]) {
        return this.context.pine.map.values(this, ...args);
    }
}
