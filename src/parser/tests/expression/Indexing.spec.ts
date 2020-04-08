import { expect } from 'chai';

import { Parser } from '../../parser';
import { Int32 } from '../../../brsTypes';
import { TokenKind } from '../../../lexer';
import { EOF, identifier, token } from '../Parser.spec';
import { Range } from 'vscode-languageserver';

describe('parser indexing', () => {
    describe('one level', () => {
        it('dotted', () => {
            let { statements, errors } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                identifier('foo'),
                token(TokenKind.Dot, '.'),
                identifier('bar'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.exist;
            expect(statements).not.to.be.null;
            //expect(statements).toMatchSnapshot();
        });

        it('bracketed', () => {
            let { statements, errors } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                identifier('foo'),
                token(TokenKind.LeftSquareBracket, '['),
                token(TokenKind.IntegerLiteral, '2', new Int32(2)),
                token(TokenKind.RightSquareBracket, ']'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.exist;
            expect(statements).not.to.be.null;
            //expect(statements).toMatchSnapshot();
        });

        it('location tracking', () => {
            /**
             *    0   0   0   1
             *    0   4   8   2
             *  +--------------
             * 0| a = foo.bar
             * 1| b = foo[2]
             */
            let { statements, errors } = Parser.parse(<any>[
                {
                    kind: TokenKind.Identifier,
                    text: 'a',
                    isReserved: false,
                    range: Range.create(0, 0, 0, 1)
                },
                {
                    kind: TokenKind.Equal,
                    text: '=',
                    isReserved: false,
                    range: Range.create(0, 2, 0, 3)
                },
                {
                    kind: TokenKind.Identifier,
                    text: 'foo',
                    isReserved: false,
                    range: Range.create(0, 4, 0, 7)
                },
                {
                    kind: TokenKind.Dot,
                    text: '.',
                    isReserved: false,
                    range: Range.create(0, 7, 0, 8)
                },
                {
                    kind: TokenKind.Identifier,
                    text: 'bar',
                    isReserved: false,
                    range: Range.create(0, 8, 0, 11)
                },
                {
                    kind: TokenKind.Newline,
                    text: '\n',
                    isReserved: false,
                    range: Range.create(0, 11, 0, 12)
                },
                {
                    kind: TokenKind.Identifier,
                    text: 'b',
                    isReserved: false,
                    range: Range.create(1, 0, 1, 1)
                },
                {
                    kind: TokenKind.Equal,
                    text: '=',
                    isReserved: false,
                    range: Range.create(1, 2, 1, 3)
                },
                {
                    kind: TokenKind.Identifier,
                    text: 'bar',
                    isReserved: false,
                    range: Range.create(1, 4, 1, 7)
                },
                {
                    kind: TokenKind.LeftSquareBracket,
                    text: '[',
                    isReserved: false,
                    range: Range.create(1, 7, 1, 8)
                },
                {
                    kind: TokenKind.IntegerLiteral,
                    text: '2',
                    literal: new Int32(2),
                    isReserved: false,
                    range: Range.create(1, 8, 1, 9)
                },
                {
                    kind: TokenKind.RightSquareBracket,
                    text: ']',
                    isReserved: false,
                    range: Range.create(1, 9, 1, 10)
                },
                {
                    kind: TokenKind.Eof,
                    text: '\0',
                    isReserved: false,
                    range: Range.create(1, 10, 1, 11)
                }
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.lengthOf(2);
            expect(statements.map(s => (s as any).value.range)).to.deep.equal([
                Range.create(0, 4, 0, 11),
                Range.create(1, 4, 1, 10)
            ]);
        });
    });

    describe('multi-level', () => {
        it('dotted', () => {
            let { statements, errors } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                identifier('foo'),
                token(TokenKind.Dot, '.'),
                identifier('bar'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });

        it('bracketed', () => {
            let { statements, errors } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                identifier('foo'),
                token(TokenKind.LeftSquareBracket, '['),
                token(TokenKind.IntegerLiteral, '2', new Int32(2)),
                token(TokenKind.RightSquareBracket, ']'),
                token(TokenKind.LeftSquareBracket, '['),
                token(TokenKind.IntegerLiteral, '0', new Int32(0)),
                token(TokenKind.RightSquareBracket, ']'),
                token(TokenKind.LeftSquareBracket, '['),
                token(TokenKind.IntegerLiteral, '6', new Int32(6)),
                token(TokenKind.RightSquareBracket, ']'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });

        it('mixed', () => {
            let { statements, errors } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                identifier('foo'),
                token(TokenKind.Dot, '.'),
                identifier('bar'),
                token(TokenKind.LeftSquareBracket, '['),
                token(TokenKind.IntegerLiteral, '0', new Int32(0)),
                token(TokenKind.RightSquareBracket, ']'),
                token(TokenKind.Dot, '.'),
                identifier('baz'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });
    });
});
