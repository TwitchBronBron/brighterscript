import * as path from 'path';
import util from '../util';
import { SourceNode } from 'source-map';
import type { CodeWithSourceMap } from 'source-map';
import type { Range } from 'vscode-languageserver';
import { isSGChildren, isSGField, isSGFunction, isSGInterface, isSGScript } from '../astUtils/xml';
import type { FileReference } from '../interfaces';
import { SGTranspileState } from './SGTranspileState';

export interface SGToken {
    text: string;
    range?: Range;
}

export interface SGAttribute {
    key: SGToken;
    value: SGToken;
    range?: Range;
}

export class SGTag {

    constructor(
        public tag: SGToken,
        public attributes: SGAttribute[] = [],
        public range?: Range
    ) { }

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
                this.attributes.splice(this.attributes.indexOf(attr));
            }
        } else if (value) {
            this.attributes.push({
                key: { text: name },
                value: { text: value }
            });
        }
    }

    transpile(state: SGTranspileState): SourceNode {
        return new SourceNode(null, null, state.source, [
            state.indent,
            '<',
            state.transpileToken(this.tag),
            ...this.transpileAttributes(state),
            ...this.transpileBody(state)
        ]);
    }

    protected transpileBody(state: SGTranspileState): (string | SourceNode)[] {
        return [' />\n'];
    }

    protected transpileAttributes(state: SGTranspileState): (string | SourceNode)[] {
        const result = [];
        for (const attr of this.attributes) {
            const offset = state.rangeToSourceOffset(attr.range);
            result.push(
                ' ',
                new SourceNode(
                    offset.line,
                    offset.column,
                    state.source,
                    [
                        attr.key.text,
                        '="',
                        attr.value.text,
                        '"'
                    ])
            );
        }
        return result;
    }
}

export class SGProlog extends SGTag {

    transpile(state: SGTranspileState) {
        return new SourceNode(null, null, state.source, [
            '<?xml',
            ...this.transpileAttributes(state),
            ' ?>\n'
        ]);
    }
}

export class SGNode extends SGTag {

    constructor(
        tag: SGToken,
        attributes?: SGAttribute[],
        public children: SGNode[] = [],
        range?: Range
    ) {
        super(tag, attributes, range);
    }

    protected transpileBody(state: SGTranspileState): (string | SourceNode)[] {
        if (this.children.length > 0) {
            const body: (string | SourceNode)[] = ['>\n'];
            state.blockDepth++;
            body.push(...this.children.map(node => node.transpile(state)));
            state.blockDepth--;
            body.push(state.indent, '</', this.tag.text, '>\n');
            return body;
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

    protected transpileBody(state: SGTranspileState): (string | SourceNode)[] {
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

    protected transpileAttributes(state: SGTranspileState): (string | SourceNode)[] {
        const result = [];
        const foundType = false;
        for (const attr of this.attributes) {
            const key = attr.key.text;
            const lowerKey = key.toLowerCase();
            let value = attr.value.text;

            if (lowerKey === 'uri' && value.match(/\.bs$/i)) {
                value = value.replace(/\.bs$/, '.brs');
            } else if (lowerKey === 'type' && ) {
                foundType = true;
            }


            const offset = state.rangeToSourceOffset(attr.range);
            result.push(
                ' ',
                new SourceNode(
                    offset.line,
                    offset.column,
                    state.source,
                    [
                        attr.key.text,
                        '="',
                        attr.value.text,
                        '"'
                    ])
            );
        }
        //add the "type" attribute if missing
        if (!foundType) {
            result.push(' type="text/brightscript"');
        }
        return result;
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

    protected transpileBody(state: SGTranspileState): (string | SourceNode)[] {
        const body: (string | SourceNode)[] = ['>\n'];
        state.blockDepth++;
        if (this.fields.length > 0) {
            body.push(...this.fields.map(node => node.transpile(state)));
        }
        if (this.functions.length > 0) {
            body.push(...this.functions.map(node => node.transpile(state)));
        }
        state.blockDepth--;
        body.push(state.indent, '</', this.tag.text, '>\n');
        return body;
    }
}

export class SGComponent extends SGTag {

    api: SGInterface;
    scripts: SGScript[] = [];
    children: SGChildren;

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
                    this.api = tag;
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

    protected transpileBody(state: SGTranspileState): (string | SourceNode)[] {
        const body: (string | SourceNode)[] = ['>\n'];
        state.blockDepth++;
        if (this.api) {
            body.push(this.api.transpile(state));
        }
        if (this.scripts.length > 0) {
            body.push(...this.scripts.map(node => node.transpile(state)));
        }
        if (this.children) {
            body.push(this.children.transpile(state));
        }
        state.blockDepth--;
        body.push(state.indent, '</', this.tag.text, '>\n');
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

    transpile(source: string, extraImports: string[]): CodeWithSourceMap {
        const { prolog, component } = this;
        if (!component) {
            return new SourceNode(null, null, null, '').toStringWithSourceMap();
        }

        //create a clone to make our changes
        const temp = new SGComponent(component.tag, component.attributes);
        temp.api = component.api;
        temp.scripts = component.scripts.map(this.updateScript);
        temp.children = component.children;

        //insert extra imports
        const extraScripts = extraImports
            .map(uri => {
                const script = new SGScript();
                script.uri = util.getRokuPkgPath(uri.replace(/\.bs$/, '.brs'));
                return script;
            });
        if (extraScripts.length > 0) {
            temp.scripts.push(...extraScripts);
        }

        const state = new SGTranspileState(source);
        const chunks = [] as Array<SourceNode | string>;
        //write XML prolog
        if (prolog) {
            chunks.push(prolog.transpile(state));
        }
        //write content
        chunks.push(temp.transpile(state));

        //sourcemap reference
        chunks.push(`<!--//# sourceMappingURL=./${path.basename(source)}.map -->`);

        return new SourceNode(null, null, source, chunks).toStringWithSourceMap();
    }
}
