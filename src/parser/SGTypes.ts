import { SourceNode } from 'source-map';
import type { Range } from 'vscode-languageserver';
import { createSGAttribute } from '../astUtils/creators';
import { isSGChildren, isSGField, isSGFunction, isSGInterface, isSGScript } from '../astUtils/xml';
import type { FileReference, TranspileResult } from '../interfaces';
import util from '../util';
import type { TranspileState } from './TranspileState';

export interface SGToken {
    text: string;
    range?: Range;
}

export class SGAttribute {
    public constructor(
        public key: SGToken,
        public equals: SGToken,
        public openingQuote: SGToken,
        public value: SGToken,
        public closingQuote: SGToken
    ) {
        //TODO handle null ranges
        this.range = util.createRangeFromPositions(
            this.key.range.start,
            (this.value?.range ?? this.equals?.range ?? this.key?.range).end
        );
    }
    public range: Range;

    public transpile(state: TranspileState) {
        return state.sourceNode(this, [
            this.key.text,
            '=',
            '"',
            this.value.text,
            '"'
        ]);
    }
}

export class SGTag {

    constructor(
        /**
         * The first portion of the startTag. (i.e. `<` or `<?`)
         */
        public startTagOpen: SGToken,
        public tagName: SGToken,
        public attributes = [] as SGAttribute[],
        /**
         * The last bit of the startTag (i.e. `/>` for self-closing, or `>` for tag with children)
         */
        public startTagClose?: SGToken,
        public children = [],
        /**
         * The endTag `<`
         */
        public endTagOpen?: SGToken,
        public endTagName?: SGToken,
        public endTagClose?: SGToken
    ) { }

    public get range() {
        return util.createRangeFromPositions(
            this.startTagOpen.range.start,
            (
                this.endTagClose ??
                this.endTagName ??
                this.endTagOpen ??
                (this.children?.[this.children?.length - 1] as Locatable) ??
                this.startTagClose ??
                this.attributes?.[this.attributes?.length - 1] ??
                this.startTagOpen
            ).range.end
        );
    }

    /**
     * Is this a self-closing tag?
     */
    get isSelfClosing() {
        return this.startTagClose?.text.startsWith('/');
    }

    get id() {
        return this.getAttributeValue('id');
    }
    set id(value: string) {
        this.setAttribute('id', value);
    }

    getAttribute(name: string): SGAttribute | undefined {
        return this.attributes.find(att => att.key.text.toLowerCase() === name);
    }

    getAttributeValue(name: string): string | undefined {
        return this.getAttribute(name)?.value?.text;
    }

    setAttribute(name: string, value: string) {
        const attr = this.getAttribute(name);
        if (attr) {
            if (value) {
                attr.value = { text: value };
                attr.range = undefined;
            } else {
                this.attributes.splice(this.attributes.indexOf(attr), 1);
            }
        } else if (value) {
            this.attributes.push(
                new SGAttribute(
                    { text: name },
                    { text: '=' },
                    { text: '"' },
                    { text: value },
                    { text: '"' }
                )
            );
        }
    }

    transpile(state: TranspileState): SourceNode {
        return new SourceNode(null, null, state.srcPath, [
            state.indentText,
            state.transpileToken(this.startTagOpen), // <
            state.transpileToken(this.tagName),
            ...this.transpileAttributes(state, this.attributes),
            ...this.transpileBody(state)
        ]);
    }

    protected transpileBody(state: TranspileState): (string | SourceNode)[] {
        return [
            ' />',
            state.newline
        ];
    }

    protected transpileAttributes(state: TranspileState, attributes: SGAttribute[]): (string | SourceNode)[] {
        const result = [];
        for (const attr of attributes) {
            result.push(' ', attr.transpile(state));
        }
        return result;
    }
}

export class SGProlog extends SGTag {
    transpile(state: TranspileState) {
        return new SourceNode(null, null, state.srcPath, [
            '<?xml',
            ...this.transpileAttributes(state, this.attributes),
            ' ?>\n'
        ]);
    }
}

export class SGNode extends SGTag {
    protected transpileBody(state: TranspileState): (string | SourceNode)[] {
        if (this.children.length > 0) {
            return [
                '>',
                state.newline,
                state.indent(1),
                ...this.children.map(node => node.transpile(state)),
                state.indent(-1),
                '</', this.tagName.text, '>\n'
            ];
        } else {
            return super.transpileBody(state);
        }
    }
}

export class SGChildren extends SGNode {

    constructor(
        tag: SGToken = { text: 'children' },
        children: SGNode[] = [],
        range?: Range
    ) {
        super(tag, [], children, range);
    }
}

export class SGScript extends SGTag {

    constructor(
        tag: SGToken = { text: 'script' },
        attributes?: SGAttribute[],
        public cdata?: SGToken,
        range?: Range
    ) {
        super(tag, attributes, range);
        if (!attributes) {
            this.type = 'text/brightscript';
        }
    }

    get type() {
        return this.getAttributeValue('type');
    }
    set type(value: string) {
        this.setAttribute('type', value);
    }

    get uri() {
        return this.getAttributeValue('uri');
    }
    set uri(value: string) {
        this.setAttribute('uri', value);
    }

    protected transpileBody(state: TranspileState): (string | SourceNode)[] {
        if (this.cdata) {
            return [
                '>',
                state.transpileToken(this.cdata),
                '</',
                this.tag.text,
                '>\n'
            ];
        } else {
            return super.transpileBody(state);
        }
    }

    protected transpileAttributes(state: TranspileState, attributes: SGAttribute[]): (string | SourceNode)[] {
        const modifiedAttributes = [] as SGAttribute[];
        let foundType = false;
        const bsExtensionRegexp = /\.bs$/i;

        for (const attr of attributes) {
            const lowerKey = attr.key.text.toLowerCase();
            if (lowerKey === 'uri' && bsExtensionRegexp.exec(attr.value.text)) {
                modifiedAttributes.push(
                    util.cloneSGAttribute(attr, attr.value.text.replace(bsExtensionRegexp, '.brs'))
                );
            } else if (lowerKey === 'type') {
                foundType = true;
                if (attr.value.text.toLowerCase().endsWith('brighterscript')) {
                    modifiedAttributes.push(
                        util.cloneSGAttribute(attr, 'text/brightscript')
                    );
                } else {
                    modifiedAttributes.push(attr);
                }
            } else {
                modifiedAttributes.push(attr);
            }
        }
        if (!foundType) {
            modifiedAttributes.push(
                createSGAttribute('type', 'text/brightscript')
            );
        }
        return super.transpileAttributes(state, modifiedAttributes);
    }
}

export class SGField extends SGTag {

    constructor(
        tag: SGToken = { text: 'field' },
        attributes: SGAttribute[] = [],
        range?: Range
    ) {
        super(tag, attributes, range);
    }

    get type() {
        return this.getAttributeValue('type');
    }
    set type(value: string) {
        this.setAttribute('type', value);
    }

    get alias() {
        return this.getAttributeValue('alias');
    }
    set alias(value: string) {
        this.setAttribute('alias', value);
    }

    get value() {
        return this.getAttributeValue('value');
    }
    set value(value: string) {
        this.setAttribute('value', value);
    }

    get onChange() {
        return this.getAttributeValue('onChange');
    }
    set onChange(value: string) {
        this.setAttribute('onChange', value);
    }

    get alwaysNotify() {
        return this.getAttributeValue('alwaysNotify');
    }
    set alwaysNotify(value: string) {
        this.setAttribute('alwaysNotify', value);
    }
}

export const SGFieldTypes = [
    'integer', 'int', 'longinteger', 'float', 'string', 'str', 'boolean', 'bool',
    'vector2d', 'color', 'time', 'uri', 'node', 'floatarray', 'intarray', 'boolarray',
    'stringarray', 'vector2darray', 'colorarray', 'timearray', 'nodearray', 'assocarray',
    'array', 'roarray', 'rect2d', 'rect2darray'
];

export class SGFunction extends SGTag {

    constructor(
        tag: SGToken = { text: 'function' },
        attributes: SGAttribute[] = [],
        range?: Range
    ) {
        super(tag, attributes, range);
    }

    get name() {
        return this.getAttributeValue('name');
    }
    set name(value: string) {
        this.setAttribute('name', value);
    }
}

export class SGInterface extends SGTag {

    fields: SGField[] = [];
    functions: SGFunction[] = [];

    constructor(
        tag: SGToken = { text: 'interface' },
        content?: SGTag[],
        range?: Range
    ) {
        super(tag, [], range);
        if (content) {
            for (const tag of content) {
                if (isSGField(tag)) {
                    this.fields.push(tag);
                } else if (isSGFunction(tag)) {
                    this.functions.push(tag);
                } else {
                    throw new Error(`Unexpected tag ${tag.tag.text}`);
                }
            }
        }
    }

    getField(id: string) {
        return this.fields.find(field => field.id === id);
    }
    setField(id: string, type: string, onChange?: string, alwaysNotify?: boolean, alias?: string) {
        let field = this.getField(id);
        if (!field) {
            field = new SGField();
            field.id = id;
            this.fields.push(field);
        }
        field.type = type;
        field.onChange = onChange;
        if (alwaysNotify === undefined) {
            field.alwaysNotify = undefined;
        } else {
            field.alwaysNotify = alwaysNotify ? 'true' : 'false';
        }
        field.alias = alias;
    }

    getFunction(name: string) {
        return this.functions.find(field => field.name === name);
    }
    setFunction(name: string) {
        let func = this.getFunction(name);
        if (!func) {
            func = new SGFunction();
            func.name = name;
            this.functions.push(func);
        }
    }

    protected transpileBody(state: TranspileState): (string | SourceNode)[] {
        const body: (string | SourceNode)[] = ['>\n'];
        state.blockDepth++;
        if (this.fields.length > 0) {
            body.push(...this.fields.map(node => node.transpile(state)));
        }
        if (this.functions.length > 0) {
            body.push(...this.functions.map(node => node.transpile(state)));
        }
        state.blockDepth--;
        body.push(state.indentText, '</', this.tag.text, '>\n');
        return body;
    }
}

export class SGComponent extends SGTag {
    constructor(
        tag: SGToken = { text: 'component' },
        attributes?: SGAttribute[],
        content?: SGTag[],
        range?: Range
    ) {
        super(tag, attributes, range);
        if (content) {
            for (const tag of content) {
                if (isSGInterface(tag)) {
                    this.interface = tag;
                } else if (isSGScript(tag)) {
                    this.scripts.push(tag);
                } else if (isSGChildren(tag)) {
                    this.children = tag;
                } else {
                    throw new Error(`Unexpected tag ${tag.tag.text}`);
                }
            }
        }
    }

    public interface: SGInterface;

    public scripts: SGScript[] = [];

    public children: SGChildren;

    get name() {
        return this.getAttributeValue('name');
    }
    set name(value: string) {
        this.setAttribute('name', value);
    }

    get extends() {
        return this.getAttributeValue('extends');
    }
    set extends(value: string) {
        this.setAttribute('extends', value);
    }

    protected transpileBody(state: TranspileState): (string | SourceNode)[] {
        const body: (string | SourceNode)[] = ['>\n'];
        state.blockDepth++;
        if (this.interface) {
            body.push(this.interface.transpile(state));
        }
        if (this.scripts.length > 0) {
            body.push(...this.scripts.map(node => node.transpile(state)));
        }
        if (this.children) {
            body.push(this.children.transpile(state));
        }
        state.blockDepth--;
        body.push(state.indentText, '</', this.tag.text, '>\n');
        return body;
    }
}

export interface SGReferences {
    name?: SGToken;
    extends?: SGToken;
    scriptTagImports: Pick<FileReference, 'pkgPath' | 'text' | 'filePathRange'>[];
}

export class SGAst {

    constructor(
        public prolog?: SGProlog,
        public root?: SGTag,
        public component?: SGComponent
    ) {
    }

    transpile(state: TranspileState) {
        const chunks = [] as TranspileResult;
        //write XML prolog
        if (this.prolog) {
            chunks.push(this.prolog.transpile(state));
        }
        if (this.component) {
            //write content
            chunks.push(this.component.transpile(state));
        }
        return chunks;
    }
}
