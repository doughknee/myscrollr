// Build a props file for the film: the variant's cue sheet, its story
// (the `story` key names a file next to the variant; story-B.json when
// unset) and the per-frame audio features, in one JSON.
// usage: node mkprops.mjs variants/song-B-synced.json variants/features-B.json out/B.props.json
import fs from "node:fs";
import path from "node:path";
const [, , variant, features, out] = process.argv;
const v = JSON.parse(fs.readFileSync(variant, "utf8"));
const f = JSON.parse(fs.readFileSync(features, "utf8"));
const storyFile = path.join(path.dirname(variant), v.story ?? "story-B.json");
v.story = JSON.parse(fs.readFileSync(storyFile, "utf8"));
v.features = { kick: f.kick, snare: f.snare, hat: f.hat, rms: f.rms };
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(v));
console.log(out, "story:", storyFile, `(${v.story.widgets.length} widgets)`, "cues:", Object.keys(v.cues).length, "frames of features:", f.kick.length);
