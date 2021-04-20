import type { CompilerPlugin } from './interfaces';
import type { Logger } from './Logger';
import { LogLevel } from './Logger';

// inspiration: https://github.com/andywer/typed-emitter/blob/master/index.d.ts
export type Arguments<T> = [T] extends [(...args: infer U) => any]
    ? U
    : [T] extends [void] ? [] : [T];

export default class PluginInterface<T extends CompilerPlugin = CompilerPlugin> {

    constructor(
        private plugins: CompilerPlugin[],
        private logger: Logger
    ) { }

    /**
     * Call `event` on plugins
     */
    public emit<K extends keyof T & string>(event: K, ...args: Arguments<T[K]>) {
        for (let plugin of this.plugins) {
            if ((plugin as any)[event]) {
                try {
                    const returnValue = this.logger.time(LogLevel.debug, [plugin.name, event], () => {
                        return (plugin as any)[event](...args);
                    });

                    //plugins can short-circuit the event by returning `false`
                    if (returnValue === false) {
                        return;
                    }
                } catch (err) {
                    this.logger.error(`Error when calling plugin ${plugin.name}.${event}:`, err);
                }
            }
        }
    }

    /**
     * Add a plugin to the beginning of the list of plugins
     */
    public addFirst(plugin: CompilerPlugin) {
        if (!this.has(plugin)) {
            this.plugins.unshift(plugin);
        }
    }

    /**
     * Add a plugin to the end of the list of plugins
     */
    public add(plugin: CompilerPlugin) {
        if (!this.has(plugin)) {
            this.plugins.push(plugin);
        }
    }

    public has(plugin: CompilerPlugin) {
        return this.plugins.includes(plugin);
    }

    public remove(plugin: CompilerPlugin) {
        if (this.has(plugin)) {
            this.plugins.splice(this.plugins.indexOf(plugin));
        }
    }
}
