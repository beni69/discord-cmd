import { model, Schema, Document } from "mongoose";

export const guild = model(
    "cooldown",
    new Schema({
        _id: String,
        cooldowns: { type: Array, default: [] },
        globalCooldowns: { type: Array, default: [] },
    })
);
export type guild = Document & {
    cooldowns: Array<{ user: string; command: string; expires: number }>;
    globalCooldowns: Array<{ command: string; expires: number }>;
};
