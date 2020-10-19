import type { BrsType } from './BrsType';
import { DoubleType } from './DoubleType';
import { DynamicType } from './DynamicType';
import { IntegerType } from './IntegerType';
import { LongIntegerType } from './LongIntegerType';

export class FloatType implements BrsType {
    public isAssignableTo(targetType: BrsType) {
        return (
            targetType instanceof FloatType ||
            targetType instanceof DynamicType
        );
    }

    public isConvertibleTo(targetType: BrsType) {
        if (
            targetType instanceof DynamicType ||
            targetType instanceof IntegerType ||
            targetType instanceof FloatType ||
            targetType instanceof DoubleType ||
            targetType instanceof LongIntegerType
        ) {
            return true;
        } else {
            return false;
        }
    }

    public toString() {
        return 'float';
    }
}
