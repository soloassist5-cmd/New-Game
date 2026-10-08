import type { SoundEvent, World } from './types';

export function emitSound(world: World, s: Omit<SoundEvent, 'id' | 'time'>): SoundEvent {
  const sound: SoundEvent = { ...s, id: world.nextSoundId++, time: world.time };
  world.tickSounds.push(sound);
  world.events.push({ type: 'sound', sound });
  return sound;
}
