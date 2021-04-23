import type { BscType } from './BscType';

/**
 * A type whose actual type is not computed until requested.
 * This is useful when the parser creates types in the middle of the file that depend on items further down in the file that haven't been parsed yet
 */
export class LazyType implements BscType {
    constructor(
        private factory: () => BscType
    ) {

    }

    public get type() {
        return this.factory();
    }

    public isAssignableTo(targetType: BscType) {
        return this.type.isAssignableTo(targetType);
    }

    public isConvertibleTo(targetType: BscType) {
        return this.type.isConvertibleTo(targetType);
    }

    public toString() {
        return this.type.toString();
    }

    public toTypeString(): string {
        return this.type.toTypeString();
    }

    public equals(targetType: BscType): boolean {
        return this.type.equals(targetType);
    }
}

