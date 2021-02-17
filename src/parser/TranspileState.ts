import { SourceNode } from 'source-map';
import type { Range } from 'vscode-languageserver';
import type { BrsFile } from '../files/BrsFile';
import type { ClassStatement } from './Statement';

/**
 * Holds the state of a transpile operation as it works its way through the transpile process
 */
export class TranspileState {
    constructor(
        /**
         * The BrsFile that is currently being transpiled
         */
        public file: BrsFile
    ) {
        this.file = file;

        //if a sourceRoot is specified, use that instead of the rootDir
        if (this.file.program.options.sourceRoot) {
            this.pathAbsolute = this.file.pathAbsolute.replace(
                this.file.program.options.rootDir,
                this.file.program.options.sourceRoot
            );
        } else {
            this.pathAbsolute = this.file.pathAbsolute;
        }
    }

    /**
     * The absolute path to the source location of this file. If sourceRoot is specified,
     * this path will be full path to the file in sourceRoot instead of rootDir.
     * If the file resides outside of rootDir, then no changes will be made to this path.
     */
    public pathAbsolute: string;

    /**
     * The number of active parent blocks for the current location of the state.
     */
    blockDepth = 0;
    /**
     * the tree of parents, with the first index being direct parent, and the last index being the furthest removed ancestor.
     * Used to assist blocks in knowing when to add a comment statement to the same line as the first line of the parent
     */
    lineage = [] as Array<{
        range: Range;
    }>;

    /**
     * Used by ClassMethodStatements to determine information about their enclosing class
     */
    public classStatement?: ClassStatement;

    /**
     * Append whitespace until we reach the current blockDepth amount
     * @param blockDepthChange - if provided, this will add (or subtract if negative) the value to the block depth BEFORE getting the next indent amount.
     */
    public indent(blockDepthChange = 0) {
        this.blockDepth += blockDepthChange;
        let totalSpaceCount = this.blockDepth * 4;
        totalSpaceCount = totalSpaceCount > -1 ? totalSpaceCount : 0;
        return ' '.repeat(totalSpaceCount);
    }

    public newline() {
        return '\n';
    }

    /**
     * Shorthand for creating a new source node
     */
    public sourceNode(locatable: { range: Range }, code: string | SourceNode | Array<string | SourceNode>): SourceNode | undefined {
        const node = new SourceNode(
            null,
            null,
            this.pathAbsolute,
            code ?? ''
        );
        if (locatable?.range) {
            //convert 0-based Range line to 1-based SourceNode line
            node.line = locatable.range.start.line + 1;
            //SourceNode columns are 0-based so no conversion necessary
            node.column = locatable.range.start.character;
        }
        return node;
    }
}
