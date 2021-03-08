import Discord from "discord.js";
import yargs from "yargs";
import Handler from "./Handler";

export default class Command {
    opts: CommandOptions & { names: string[] };
    run: CommandCallback;

    constructor(opts: CommandOptions, run: CommandCallback) {
        this.run = run;

        // if name is "name" convert it to "[name]"
        if (typeof opts.names === "string")
            this.opts = { ...opts, names: [opts.names] };
        else this.opts = { ...opts, names: opts.names };
    }
}

export interface CommandOptions {
    names: string[] | string;
    description?: string;
    category?: string;
    adminOnly?: boolean;
    test?: boolean;
}
export interface CommandParams {
    client: Discord.Client;
    message: Discord.Message;
    args: string[];
    argv: yargs.Arguments;
    prefix: string;
    handler: Handler;
}

export type CommandCallback = (params: CommandParams) => void;
