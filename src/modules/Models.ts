import { model, Schema } from "mongoose";

export const guild = model(
    "guild",
    new Schema({
        _id: String,
        cooldowns: { type: Array, default: [] },
        globalCooldowns: { type: Array, default: [] },
    })
);
export type guild = {
    _id: string;
    cooldowns: Array<{ user: string; command: string; expires: number }>;
    globalCooldowns: Array<{ command: string; expires: number }>;
};