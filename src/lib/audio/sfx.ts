export interface SoundEffect {
  id: string;
  label: string;
  hint: string;
  file: string;
  duration: number;
  badge?: string;
}

export const SOUND_EFFECTS: SoundEffect[] = [
  {
    id: "auracut_stinger",
    label: "AuraCut Stinger",
    hint: "Signature 1.5s 808 explosion + neon logo ending",
    file: "/audio/sfx/auracut_stinger.wav",
    duration: 1.5,
    badge: "Signature",
  },
  {
    id: "sub_boom",
    label: "808 Sub Boom",
    hint: "Cinematic earthquake bass drop",
    file: "/audio/sfx/sub_boom.wav",
    duration: 1.8,
  },
  {
    id: "whoosh",
    label: "Stereo Whoosh",
    hint: "Aerodynamic fast whip transition",
    file: "/audio/sfx/whoosh.wav",
    duration: 0.6,
  },
  {
    id: "riser",
    label: "Tension Riser",
    hint: "Exponential pitch riser into beat drops",
    file: "/audio/sfx/riser.wav",
    duration: 2.2,
  },
  {
    id: "vinyl_scratch",
    label: "Vinyl Scratch",
    hint: "Pattern-interrupt comedy stop",
    file: "/audio/sfx/vinyl_scratch.wav",
    duration: 0.7,
  },
];
