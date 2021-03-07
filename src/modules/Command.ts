import Discord from "discord.js";
import yargs from "yargs";
import Handler from "./Handler";

export default class Command {
    opts: { names: string[]; adminOnly?: boolean; test?: boolean };
    run: (params: {
        client: Discord.Client;
        message: Discord.Message;
        args: string[];
        argv: yargs.Arguments;
        prefix: string;
        handler: Handler;
    }) => void;

    constructor(
        opts: { names: string[] | string; adminOnly?: boolean; test?: boolean },
        run: (params: {
            client: Discord.Client;
            message: Discord.Message;
            args: string[];
            argv: yargs.Arguments;
            prefix: string;
            handler: Handler;
        }) => void
    ) {
        this.run = run;

        // if name is string convert it to "[name]"
        if (typeof opts.names === "string")
            this.opts = { ...opts, names: [opts.names] };
        else this.opts = { ...opts, names: opts.names as string[] };
    }
}
