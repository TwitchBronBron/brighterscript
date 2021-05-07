import type { Range } from './astUtils';
import { isLazyType } from './astUtils/reflection';
import type { BscType } from './types/BscType';
import { DynamicType } from './types/DynamicType';
import type { LazyTypeContext } from './types/LazyType';
import { UninitializedType } from './types/UninitializedType';


/**
 * Stores the types associated with variables and functions in the Brighterscript code
 * Can be part of a hierarchy, so lookups can reference parent scopes
 */
export class SymbolTable {
    constructor(
        private parent?: SymbolTable | undefined
    ) { }

    /**
     * The map of symbols declared directly in this SymbolTable (excludes parent SymbolTable).
     * Indexed by lower symbol name
     */
    private symbolMap = new Map<string, BscSymbol[]>();

    /**
     * Get list of symbols declared directly in this SymbolTable (excludes parent SymbolTable).
     */
    public get ownSymbols(): BscSymbol[] {
        return [].concat(...this.symbolMap.values());
    }

    /**
     * Sets the parent table for lookups
     *
     * @param [parent]
     */
    setParent(parent?: SymbolTable) {
        this.parent = parent;
    }

    /**
     * Checks if the symbol table contains the given symbol by name
     * If the identifier is not in this table, it will check the parent
     *
     * @param name the name to lookup
     * @param searchParent should we look to our parent if we don't have the symbol?
     * @returns true if this symbol is in the symbol table
     */
    hasSymbol(name: string, searchParent = true): boolean {
        const key = name.toLowerCase();
        let result = this.symbolMap.has(key);
        if (!result && searchParent) {
            result = !!this.parent?.hasSymbol(key);
        }
        return result;
    }

    /**
     * Gets the name/type pair for a given named variable or function name
     * If the identifier is not in this table, it will check the parent
     *
     * @param  name the name to lookup
     * @param searchParent should we look to our parent if we don't have the symbol?
     * @returns An array of BscSymbols - one for each time this symbol had a type implicitly defined
     */
    getSymbol(name: string, searchParent = true): BscSymbol[] {
        const key = name.toLowerCase();
        let result = this.symbolMap.get(key);
        if (!result && searchParent) {
            result = this.parent?.getSymbol(key);
        }
        return result;
    }

    /**
     * Adds a new symbol to the table
     * @param name
     * @param  type
     */
    addSymbol(name: string, range: Range, type: BscType) {
        const key = name.toLowerCase();
        if (!this.symbolMap.has(key)) {
            this.symbolMap.set(key, []);
        }
        this.symbolMap.get(key).push({
            name: name,
            range: range,
            type: type
        });
    }

    /**
     * Gets the type for a symbol
     * @param name the name of the symbol to get the type for
     * @param searchParent should we look to our parent if we don't have the symbol?
     * @param context the context for where this type was referenced - used ONLY for lazy types
     * @returns The type, if found. If the type has ever changed, return DynamicType. If not found, returns UninitializedType
     */
    getSymbolType(name: string, searchParent = true, context?: LazyTypeContext): BscType {
        const key = name.toLowerCase();
        const symbols = this.symbolMap.get(key);
        if (symbols?.length > 1) {
            //Check if each time it was set, it was set to the same type
            // TODO handle union types
            let sameImpliedType = true;
            let impliedType = symbols[0].type;
            for (const symbol of symbols) {
                sameImpliedType = (impliedType.equals(symbol.type));
                if (!sameImpliedType) {
                    break;
                }
            }
            return sameImpliedType ? impliedType : new DynamicType();
        } else if (symbols?.length === 1) {
            if (isLazyType(symbols[0].type)) {
                return symbols[0].type.getTypeFromContext(context);
            }
            return symbols[0].type;
        }
        if (searchParent) {
            return this.parent?.getSymbolType(name, true, context) ?? new UninitializedType();
        } else {
            return new UninitializedType();
        }
    }

    /**
     * Adds all the symbols from another table to this one
     * It will overwrite any existing symbols in this table
     * @param symbolTable
     */
    mergeSymbolTable(symbolTable: SymbolTable) {
        for (let [, value] of symbolTable.symbolMap) {
            for (const symbol of value) {
                this.addSymbol(
                    symbol.name,
                    symbol.range,
                    symbol.type
                );
            }
        }
    }
}


export interface BscSymbol {
    name: string;
    range: Range;
    type: BscType;
}