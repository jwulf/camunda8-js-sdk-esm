// deno-lint-ignore-file no-explicit-any

// Metadata polyfill for Node and Browser
(Symbol.metadata as any) ??= Symbol("Symbol.metadata");

interface Context {
    kind: string;
    name: string | symbol;
    access: {
      get?(value: unknown): any;
      set?(object: unknown, value: any): void;
    };
    isPrivate?: boolean;
    isStatic?: boolean;
    addInitializer?(initializer: () => void): void;
    metadata: Record<string | number | symbol, unknown>;
  }

type Decorator<T> = (value: T, context: Context) => T | void;

function setMetadata(x: string): Decorator<any> {
    return function (_target: any, context: Context) {
        context.metadata[context.name] = x;
    }
}

class SomeClass {
    @setMetadata('something')
    foo = 123;

    @setMetadata('Something else')
    accessor bar = "hello!";

    @setMetadata('something')
    baz() { }
}

const ourMetadata = SomeClass[Symbol.metadata];

console.log(JSON.stringify(ourMetadata));
// { "bar": true, "baz": true, "foo": true }