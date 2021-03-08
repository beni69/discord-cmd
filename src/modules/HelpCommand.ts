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
    const settings = handler.opts.helpCommand!;

    const command = new Command(
        { names: settings.names },
        ({ message, client, handler, argv }) => {
            const embed = new MessageEmbed()
                .setColor(settings?.color || "RANDOM")
                .setTitle(settings?.title || client.user?.username)
                .setTimestamp()
                .setFooter(
                    message.author.tag,
                    message.author.displayAvatarURL({ dynamic: true })
                );

            const commands = handler.commands;
            const categories = new Map<string, Array<Command>>();

            commands
                // ignore the help command and test commands
                .filter(
                    item =>
                        item.opts.names !== command.opts.names &&
                        !(
                            item.opts.test === true ||
                            handler.opts.testServers.has(message.guild!.id)
                        )
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
                    [`**${item.opts.names[0]}**`, item.opts.description].join(
                        "\n"
                    )
                );
                embed.addField(
                    `*${capitalise(c[0].opts.category as string)}*`,
                    field
                );
            });

            message.channel.send({ embed });

            function capitalise(str: string) {
                return str[0].toUpperCase() + str.substr(1);
            }
        }
    );

    handler.commands.set(command.opts.names[0], command);
}
declare const emb: MessageEmbed;
