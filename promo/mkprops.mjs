// Merge a variant's cue sheet with its per-frame audio features into one props file.
// usage: node mkprops.mjs variants/song-B-synced.json variants/features-B.json out/props-B.json
import fs from "node:fs";
const [, , variant, features, out] = process.argv;
const v = JSON.parse(fs.readFileSync(variant, "utf8"));
const f = JSON.parse(fs.readFileSync(features, "utf8"));
v.features = { kick: f.kick, snare: f.snare, hat: f.hat, rms: f.rms };
fs.mkdirSync("out", { recursive: true });
fs.writeFileSync(out, JSON.stringify(v));
console.log(out, "cues:", Object.keys(v.cues).length, "frames of features:", f.kick.length);
