import { ColorResolvable, MessageEmbed } from "discord.js";
import Command from "./Command";
import Handler from "./Handler";

export interface HelpSettings {
    names: string[] | string;
    title?: string;
    color?: ColorResolvable;
    categories?: boolean;
}

export function init(handler: Handler) {
    const settings: HelpSettings = handler.getOpts.helpCommand!;

    const command = new Command(
        { names: settings.names, description: "Display help" },
        ({ trigger, client, handler, text, argv }) => {
            const embed = new MessageEmbed()
                .setColor(settings?.color || "RANDOM")
                .setTimestamp()
                .setFooter(
                    trigger.author.tag,
                    trigger.author.displayAvatarURL({ dynamic: true })
                );

            //*  default help command
            if (!text) {
                embed.setTitle(settings.title || client.user!.username);
                const commands = handler.getCommands;
                const categories = new Map<string, Array<Command>>();

                // ignore the help command and test commands in non-test servers
                commands
                    .filter(
                        item =>
                            item.opts.names !== command.opts.names &&
                            (!item.opts.test ||
                                handler.getOpts.testServers.has(
                                    trigger.guild!.id
                                ))
                    )
                    .forEach(item => {
                        const c =
                            categories.get(item.opts.category as string) || [];
                        c?.push(item);
                        categories.set(
                            item.opts.category as string,
                            c as Command[]
                        );
                    });

                categories.forEach(c => {
                    const field = c.map(item =>
                        [
                            `**${capitalise(item.opts.names[0])}**`,
                            item.opts.description,
                        ]
                            .join("\n")
                            .trim()
                    );
                    embed.addField(
                        `*${capitalise(c[0].opts.category as string)}*`,
                        field.join("\n"),
                        true
                    );
                });
            }
            //* help for a specific command
            else {
                const command = handler.getCommand(text);
                if (!command) return;

                embed
                    .setTitle(command.opts.names[0])
                    .setDescription(
                        command.opts.description ||
                            "This command doesn't have a description."
                    )
                    .addField("Category", command.opts.category!, true);
            }

            trigger.channel.send({ embeds: [embed] });

            function capitalise(str: string) {
                return str[0].toUpperCase() + str.substr(1);
            }
        }
    );

    handler.commands.set(command.opts.names[0], command);
}
