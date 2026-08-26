# Seedance Prompts — Curated

Ten prompts kept from the 105 published in [YouMind-OpenLab/awesome-seedance-2-prompts](https://github.com/YouMind-OpenLab/awesome-seedance-2-prompts), selected for prompt craft rather than for the look of the output video.

## Why these ten

The source repo is a scrape of community posts, regenerated from a private CMS every four hours with no editorial pass. Across the 105 prompts in its README:

| | |
|---|---|
| Reference-dependent (need images you don't have) | 42 (40%) |
| Truncated mid-sentence by the scraper | ~6 |
| Under 60 words | 13 |
| Containing raw platform asset IDs | 2 |
| Usable verbatim, text-only, complete | 60 (57%) |
| Hit 3 of 4 craft markers (timing / camera / audio / consistency) | 19 (18%) |
| Hit all 4 | 3 (3%) |

These ten are the intersection of *complete*, *substantial* (200w+), and *structurally disciplined* — they segment time into beats, direct the camera per beat, and constrain what must stay consistent. Four still require reference images; they're kept because their structure is worth copying even when their assets aren't available, and they're flagged below.

## What they have in common

The pattern worth stealing, in four parts:

1. **A global block first** — style, duration, aspect ratio, and the one physical rule that governs the whole clip, stated before any beat.
2. **Timecoded beats** — `0-4s`, `[00:00-00:05]`, `ACT 1 (0-4s)`. One camera instruction per beat, stated separately from the action.
3. **An explicit consistency clause** — what must not drift (face, wardrobe, prop geometry, environment), written as a constraint rather than a hope.
4. **A separate audio line** — sound is directed on its own, not implied by the scene. Note that silence gets stated too (`No voice`, `no dialogue, no subtitles`).

The strongest ones add a *negative* block and an anti-shortcut clause — see #9, which forbids the model from collapsing a five-stage movement into one motion.

---

## The prompts

### 1. Seedance 2.0: 15-Second Cinematic Japanese Romance Short Film

**15s** · 598 words · text-only

The reference implementation. Three timed beats, per-beat camera move, micro-expression direction, dialogue with 200-400ms pause timing, and a four-layer audio bed that resolves cicadas to piano.

```text
15-second cinematic Japanese drama pure love ambiguous short film, ultra-realistic quality, warm golden sunlight in an empty classroom in the afternoon, spilling through the blinds onto the side-by-side desks, fine dust motes slowly floating in the light beams, old wooden desks, extremely natural subtle movements, breathing, and eye tension, characters maintain consistent faces, clothing, and hairstyles throughout without deformation, drift, or artifacts, real slight chest rise and fall synchronized with breathing, shallow depth of field, creamy blurred background, warm film grain, 8K sharp, Japanese youth restrained heart-fluttering suffocating atmosphere.
0-4 seconds: Extremely slow push-in shot from a medium shot of the desktop to a close-up of the two people's side profiles sitting side-by-side. A pure girl in a summer school uniform is focused on writing notes with her head down, long black hair and stray hairs by her ears are gently lifted by a slight breeze, long eyelashes cast subtle shadows, skin is naturally pink and tender, a slight, unintentional upturn of the corner of her mouth in concentration, light and even breathing.
4-9 seconds: Switch to a close-up of the boy. His school uniform collar is slightly loose, he props his elbow on the desk and secretly turns his head to gaze at her, his eyes filled with gentle, restrained affection and tenderness, pupils slightly dilated, his Adam's apple gently rolls. Suddenly noticing her pen pause, he quickly and flusteredly turns his head to pretend to look at his own notes, his earlobes quickly turn slightly red, his fingertips tremble slightly as he grips the pen, occasionally glancing at her from under his bangs, his breathing is slightly disordered, and his lips are tightly pressed in an effort to remain calm.
9-15 seconds: Extreme close-up of both faces in the same frame, slow-motion eyes suddenly meet: the girl slowly turns her head, first showing a dazed surprise, then quickly and shyly lowers her head for 0.3 seconds, gently biting her lower lip, her cheeks and earlobes instantly bloom with cherry blossom pink, her moist eyelashes timidly look up to meet his gaze again, while softly and shyly whispering, "...What are you looking at?"; the boy freezes completely, his pupils dilate, and he is stunned for 0.4 seconds, then flusteredly and quietly stutters in response, "N-nothing...". The girl whispers even quieter, biting her lip and peeking at him again, continuing to whisper, "...Liar.". The boy pauses, then gently sighs and whispers, "...Just looking at you.", the corner of his mouth slowly curls up into a shy, gentle, crooked smile, fine lines appear at the corners of his eyes, and his breathing noticeably deepens. An invisible current seems to pull the ambiguous tension between their faces, sharing each other's breathing temperature, the background completely melts into layers of creamy, dreamy light spots, warm halos, and fine air particles.
Lip synchronization is natural and precise, emotional micro-tremors and breathing are synchronized, dialogue is low-energy whispering with a shy tone, natural short pauses between 200-400 milliseconds, the mouth only moves slightly when speaking, without exaggeration or robotic feel, perfect natural lip-sync and emotional authenticity.
Overall Sound Effects: Distant summer cicada chirping faintly, the soft scratching sound of the pen touching the paper, the almost inaudible low-frequency pulse of their heartbeats, finally fading into a very light, airy piano. The dialogue is completely naturally integrated into the scene as whispers, the girl's voice is soft and shy, the boy transitions from flustered stuttering to gentle.
Character identity is maintained throughout, real subtle head tilts, eye movements, and breathing synchronization, no text, watermarks, or subtitles, pure Japanese style youth secret crush heart-fluttering suspense.
```

— [AIGC｜阳家豪](https://x.com/JiahaoYang_art) · [source](https://x.com/JiahaoYang_art/status/2033119940216344616) · March 15, 2026 · [example video](https://github.com/YouMind-OpenLab/awesome-seedance-2-prompts/releases/download/videos/1402.mp4) · [gallery](https://youmind.com/en-US/seedance-2-0-prompts?id=1402)

---

### 2. Hollywood Haute Couture Fantasy Video Prompt

**15s** · 314 words · text-only

Bracketed-header format ([Style]/[Duration]/[Scene]) with a camera-position line per shot. Each beat states position, action, and effect separately instead of blending them into prose.

```text
[Style] Hollywood Haute Couture Fantasy blockbuster, 8K ultra-clear, Photorealistic, High-fashion Editorial Style, Unreal Engine 5 fluid rendering, visual illusion. [Duration] 15 seconds. [Scene] An endless, real-life Salar de Uyuni (Sky Mirror) salt flat. The sky is filled with oppressive dark clouds, and the ground perfectly reflects everything like a mirror, with the overall picture presenting a minimalist, cool tone. [00:00-00:05] Shot 1: Haute Couture Entrance and Porcelain Skin. Camera position: Extremely low-angle upward shot, ultra-telephoto lens zoom-in. Action: An Asian female model with a highly recognizable, high-fashion face walks coolly on the water surface. Effect: She is wearing not fabric, but a long dress made of flowing, real Liquid Blue-and-White Porcelain. As she walks, the skirt makes a crisp collision sound like real ceramic, with a flowing luster on the surface. The traditional blue-and-white patterns move across the white porcelain-textured skirt as if alive. [00:05-00:10] Shot 2: Physical Shattering and Ink-wash Descent. Camera position: Extreme close-up of the face, focus rapidly pulls back. Action: The model suddenly stops, stares coldly at the camera, and snaps her fingers crisply. Effect: The moment the fingers snap, her blue-and-white porcelain dress does not fall, but instantly explodes into thousands of extremely photorealistic Ink-wash Swallows. These swallows carry real water droplets and ink marks, dragging black fluid afterimages in the air, spinning frantically around her. [00:10-00:15] Shot 3: Dimensional Dissolution and Abyss Reflection. Camera position: High-altitude overhead shot, camera rapidly rotates and descends. Action: The swarm of ink-wash swallows plunges into the mirrored lake water beneath the model's feet. Effect: The surface tension of the originally solid salt lake instantly disappears. The entire extremely realistic world begins to violently bleed and dissolve like concentrated ink dropped into clear water. The real dark clouds and the model's figure transform entirely into an extremely grand 3D Fluid Ink Vortex, completely swallowing the camera into a black and white interwoven abyss.
```

— [John](https://x.com/johnAGI168) · [source](https://x.com/johnAGI168/status/2025849650654122348) · February 23, 2026 · [example video](https://github.com/YouMind-OpenLab/awesome-seedance-2-prompts/releases/download/videos/594.mp4) · [gallery](https://youmind.com/en-US/seedance-2-0-prompts?id=594)

---

### 3. Alligator Mutant Rescue Scene

**15s** · 344 words · text-only

Beats labelled by narrative function (HOOK / ESCALATION / THE PROBLEM / CHAOS / PAYOFF), which keeps pacing legible. Sound design declared once up front, then never restated.

```text
Hyper-real B-movie creature-feature action. Tropical jungle. Heavy rain from a recent storm. Overgrown railroad crossing cutting through dense vegetation. Rusted warning signs. Fast chaotic pacing. Aggressive handheld camera. Speed ramps. Crash zooms. Whip pans. Sound: engine screaming, crocodile roars, train horn, metal shaking, frantic breathing.  ⸻  0–2s — HOOK  Low front-mounted camera on a speeding jeep.  A survivor is already driving at full speed down a muddy jungle road.  The windshield is covered in mud and rain.  Behind him—  A gigantic mega crocodile bursts through the jungle.  Forty feet long.  Ancient scars across its body.  It crashes through trees and keeps pace with the jeep.  The driver glances into the rear-view mirror.  “COME ON!”  ⸻  2–5s — ESCALATION  Side tracking shot.  The jeep bursts out of the jungle toward an abandoned railroad crossing.  The crocodile gains rapidly.  Its jaws snap shut inches behind the rear bumper.  Mud sprays everywhere.  The survivor spots the tracks ahead and floors the accelerator.  The crocodile lunges.  The jeep barely stays ahead.  ⸻  5–8s — THE PROBLEM  Wide shot.  The jeep reaches the railroad crossing.  Suddenly—  The engine dies.  The vehicle rolls to a stop directly on the tracks.  Silence.  Then a distant train horn.  The survivor looks left.  A freight train is approaching at full speed.  He looks right.  The crocodile is charging.  ⸻  8–11s — CHAOS  Rapid cut-tos.  Train getting closer.  Crocodile getting closer.  The survivor desperately tries restarting the engine.  Nothing.  The crocodile launches forward.  The train horn becomes deafening.  At the very last second—  The survivor dives out of the jeep.  ⸻  11–13s — PAYOFF  Bullet-time shot.  The crocodile leaps.  The freight train arrives.  Impact.  Metal bends.  Mud explodes.  The crocodile is smashed sideways across the crossing.  The jeep is obliterated.  ⸻  13–15s — SHOCKING ENDING  The survivor stands up.  Relieved.  The train continues rolling.  Then—  Something enormous climbs over the top of the moving train.  A gigantic reptilian creature larger than the crocodile.  Its claw crushes a train car roof.  The entire train begins derailing.  The survivor stares in disbelief.  Hard cut to black.
```

— [DennisVisuals](https://x.com/DtheW1995) · [source](https://x.com/DtheW1995/status/2091783920467456468) · Aug 24, 2026 · [gallery](https://youmind.com/en-US/seedance-2-0-prompts?id=9762)

---

### 4. Pop-up Book Paper Craft Animation

**15s** · **16:9** · 230 words · text-only

The tightest prompt in the set at 230 words. ACT 1-4 structure, one physical rule ('everything exists as physical paper') that governs every beat, and an explicit 'No voice' before the audio line.

```text
Pop-up book paper craft animation, 15 seconds, 16:9. Masterpiece paper engineering. Multi-layered topographic paper design, intricate cut-paper landscapes, embossed details, gold foil map markings, moving paper mechanisms, handcrafted textures, cinematic warm lighting, shallow depth of field. Everything exists as physical paper emerging from an antique atlas. No voice. Audio: turning pages, rustling paper, subtle orchestral wonder. ACT 1 (0-4s) An ancient atlas opens. A magnificent paper map unfolds across both pages. Mountains rise in layered paper relief. Forests, rivers, bridges, cities, and ships emerge from hidden folds. Tiny paper clouds float above the landscape. Camera travels low across the terrain. ACT 2 (4-8s) A page turns. The map begins reorganizing itself. Rivers fold upward into roads. Mountains flatten and transform into oceans. Cities slide across hidden paper tracks. Entire regions rotate and lock into new positions like a giant mechanical puzzle. ACT 3 (8-12s) Another page turns. The map becomes increasingly impossible. New continents unfold from beneath existing continents. Bridges span across the sky. Floating islands emerge from layered mechanisms. Endless paper geography grows outward beyond the original map. ACT 4 (12-15s) Final page turn. The entire world folds inward through thousands of synchronized paper movements, transforming into a giant ornate compass made from landscapes, cities, oceans, and mountains. The compass expands and unfolds into an even larger impossible map extending beyond the book's edges. Freeze on the completed transformation.
```

— [Alexandra Aisling](https://x.com/AllaAisling) · [source](https://x.com/AllaAisling/status/2091584001282900033) · Aug 23, 2026 · [gallery](https://youmind.com/en-US/seedance-2-0-prompts?id=9720)

---

### 5. Nostalgic DV Camcorder Fairground Video

**15s** · 203 words · text-only

Separates Subject / Location / Visual Style / Camera Style / Timeline / Audio into labelled fields. Camera style is specified as a failure mode to emulate (autofocus hunting, exposure pumping) rather than as a look.

```text
Main Subject:
Young Korean woman, early 20s, light cardigan over a summer dress, small crossbody bag, hair down and slightly wavy, excited cheerful expression.
Location: Small local fairground, early evening. Ferris wheel lights starting to glow, distant carnival games, scattered benches, string lights overhead. No crowds, no commercial branding.
Visual Style:
Ultra-realistic documentary realism, joyful candid feeling, soft dusky evening light.
Camera Style:
Early 2000s consumer DV camcorder aesthetic, handheld shake, autofocus hunting on flashing lights, exposure pumping between bright lights and shadow. No stabilization.
Timeline (15 sec, each slot = 2 compressed beats):
00:00–00:03 → She sits in the ferris wheel cabin, then looks out as it slowly rises.
00:03–00:06 → She turns to camera saying "여기서 보는 경치 진짜 좋다" ("The view from here is really nice"), smiling.
00:06–00:09 → The cabin reaches the top; she gasps softly at the skyline view.
00:09–00:12 → She points at something below, laughing excitedly.
00:12–00:15 → She looks at camera saying "다시 타고 싶다" ("I want to ride again"), grinning as it fades.
Audio:
Faint carnival music in distance, wind, creaking cabin, distant chatter. Her dialogue as noted above. No music beyond ambient scene sound.
Goal: A joyful, nostalgic fair moment warm, excited, believable.
```

— [𝐌](https://x.com/Strength04_X) · [source](https://x.com/Strength04_X/status/2091580274610258004) · Aug 23, 2026 · [gallery](https://youmind.com/en-US/seedance-2-0-prompts?id=9709)

---

### 6. Japanese Festival Travel Vlog

**25s** · 397 words · **needs reference images**

> ⚠️ Requires: Image 1 — the woman's face/hairstyle — not included in the source repo.

25 seconds in five beats, each a complete vlog action with its own motivation. Useful mainly as a structural template for talking-to-camera footage.

```text
Create an ultra-photorealistic live-action smartphone travel vlog scene that initially looks like an authentic real travel vlog.

MAIN CHARACTER:

Use Image 1 only for the woman's recognizable facial identity, natural facial features and hairstyle.

She is a young Japanese woman wearing a beautiful pastel yukata with natural traditional styling. Keep her identity and appearance consistent throughout the entire video.

LOCATION:

A traditional Japanese summer festival at night. Lantern-lit streets, festival stalls, warm practical lighting, crowds of people, traditional decorations, and an authentic Japanese summer festival atmosphere.

VISUAL STYLE:

Ultra-photorealistic smartphone travel vlog.

Realistic human performance.

Realistic skin texture.

Natural fabric physics.

Authentic smartphone camera quality.

Natural handheld camera movement.

Authentic ambient festival sounds.

Cinematic but believable vlog footage.

No obvious AI appearance.

00–05s — THE OPENING SHOT

Begin with a natural selfie-style smartphone shot of the woman walking through the lantern-lit festival streets.

She films herself while walking naturally through the crowd.

The camera has realistic handheld movement and authentic smartphone stabilization.

Festival lanterns, people, stalls and decorations appear naturally in the background.

Everything feels like genuine travel-vlog footage.

05–10s — THE TAKOYAKI MOMENT

She approaches a traditional festival food stall and buys fresh takoyaki.

The camera remains in natural selfie mode while she shows the food toward the camera.

She takes a bite of the takoyaki and smiles naturally.

Her facial expression and movements remain realistic and spontaneous.

The surrounding festival ambience and crowd sounds remain authentic.

10–15s — THE FESTIVAL GAME

She walks toward a traditional Japanese festival game.

She plays the game naturally and successfully wins a small plush toy.

She reacts with genuine excitement and happiness.

She briefly holds the plush toy toward the camera while smiling.

The camera movement remains natural and handheld, maintaining consistent identity and appearance.

15–20s — THE FIREWORKS

The scene transitions naturally as she joins the crowd watching a spectacular fireworks display.

The camera captures her genuine excitement as colorful fireworks illuminate the night sky behind her.

Her face is naturally illuminated by the fireworks.

The crowd reacts realistically in the background.

The atmosphere feels immersive, authentic and cinematic while still looking like real smartphone footage.

20–25s — THE FINAL VLOG MOMENT

She turns the smartphone camera toward herself again.

The fireworks continue in the background.

She smiles naturally while holding the small plush toy she won earlier.

Her expression shows genuine happiness and excitement from the festival
```

— [Saira](https://x.com/AiWithSaira) · [source](https://x.com/AiWithSaira/status/2091461673261662450) · Aug 23, 2026 · [gallery](https://youmind.com/en-US/seedance-2-0-prompts?id=9710)

---

### 7. Heavy Metal Anime Music Video

**30s** · 225 words · **needs reference images**

> ⚠️ Requires: 3 character refs (K1 bassist, D1 guitarist, G1 drummer) — not included in the source repo.

Rare example of driving the cut rather than the frame: BPM stated (180), shot vocabulary enumerated, lyrics supplied inline so the edit has something to sync against.

```text
Create a **30-second anime-style heavy metal music video** featuring these three band members.
**K1** is the bassist on screen left, **D1** is the guitarist on screen right, and **G1** is the drummer in the center.
The setting is a **nighttime rooftop stage** with the **AB/CD** platform, multiple amplifiers, spotlights, and a city skyline in the background.
The song is **fast, fun, intense, and dynamic**, at **BPM 180**. Prioritize the energy and groove of the performance.
Use **rapid music-video style editing** with a natural mix of **face close-ups, hand close-ups, shots of bass and guitar picking, drum-hit close-ups, low-angle shots, high-angle shots, front shots, diagonal shots, and light camera movement around the performers**.
Give each of the three members clear spotlight moments, especially showing their **facial expressions, playing motions, and performance intensity**.
Match the flow of the lyrics:
**“Stuffed again, I can't deny / Third plate calling, don't ask why / Rice and ramen, sweet and fried / OVERFED! OVERFED! / No regrets, I ate it all / Rolling home, I hit the wall! / OVERFED tonight!”**
Build naturally from **intro to verse to chorus** with rising excitement.
**Final shot:** K1 and D1 stand behind the drums, with G1 in the center, ending on a **close-up of all three together**.
Render it in **high quality**, with **consistent character appearance, strong live-performance lighting, and energetic camera work**.
```

— [Hei](https://x.com/heisuke123) · [source](https://x.com/heisuke123/status/2090979140770136297) · Aug 22, 2026 · [gallery](https://youmind.com/en-US/seedance-2-0-prompts?id=9598)

---

### 8. Surreal Desert Mirror Fantasy

**30s** · **16:9** · 776 words · **needs reference images**

> ⚠️ Requires: image_1 Ash Knight, image_2 Obsidian Rival, image_3 Magma Greatsword — not included in the source repo.

The most complete spec here: subject anchors, per-beat focal lengths (24/35/50/85mm), separate CHARACTER CONTINUITY and ENVIRONMENT CONTINUITY blocks, a real negative prompt, and a director's note on what to withhold.

```text
SUBJECT ANCHOR 1: <<<image_1>>> — Ash Knight SUBJECT ANCHOR 2: <<<image_2>>> — Obsidian Rival PROP ANCHOR: <<<image_3>>> — Magma Greatsword DURATION: 30 seconds ASPECT RATIO: 16:9 STYLE: Surreal cinematic dark fantasy / science-fantasy CAMERA: Large-format cinema, 24mm / 35mm / 50mm / 85mm FRAME RATE: 24fps with selective 60fps STORY In the middle of an endless desert stands a gigantic circular mirror buried vertically in the sand. Ash Knight arrives from one direction. Obsidian Rival arrives from another. The mirror does not reflect them. Instead, it shows a completely different version of the desert—one thousands of years in the future. --- 00:00–00:05 — THE DESERT Open with an enormous aerial shot of an endless black-and-gold desert at sunset. Wind creates long patterns across the dunes. At the center of the landscape stands a gigantic circular metallic structure half-buried in the sand. The camera descends toward it. Ash Knight appears as a distant silhouette walking across the dunes. --- 00:05–00:09 — THE SECOND ARRIVAL Cut to a 50mm side profile. Ash Knight reaches the structure. Across the enormous circular mirror, Obsidian Rival emerges from the opposite side. Both stop. The mirror stands between them. The camera slowly moves sideways, keeping the entire structure centered. --- 00:09–00:13 — THE MIRROR 85mm close-up. The surface of the mirror is perfectly black. Ash Knight approaches it. His reflection should appear— but it doesn't. Instead, the mirror shows the same location thousands of years later. The desert has disappeared. A massive futuristic city now covers the landscape. --- 00:13–00:17 — THE FUTURE 35mm composition. Obsidian Rival steps closer. The mirror changes again. It shows a completely different future. The city is now empty. Towering structures are covered in sand. A gigantic red moon hangs above the horizon. The two warriors look toward the impossible reflection. --- 00:17–00:21 — THE SWORD 85mm macro. Ash Knight draws the Magma Greatsword. The red lava veins pulse. The mirror responds. A thin red reflection appears across its surface. The reflection of the sword suddenly becomes visible even though the warriors still have no reflections. --- 00:21–00:25 — THE FRACTURE Ash Knight slowly raises the Greatsword toward the mirror. He does not strike. The mirror surface begins developing thin luminous cracks by itself. The cracks spread outward like a massive geometric pattern. The desert wind suddenly stops. Every grain of sand becomes completely still. --- 00:25–00:28 — THE OTHER WORLD The mirror opens like a doorway. Beyond it is not another desert. It is an enormous ocean suspended vertically in the sky. Massive floating structures drift beneath the water. The camera slowly pushes forward. Both warriors remain behind the threshold. --- 00:28–00:30 — FINAL IMAGE Extreme wide shot. The circular mirror now stands open in the middle of the desert. Inside it, the impossible ocean-world stretches endlessly. Ash Knight and Obsidian Rival stand on opposite sides of the opening. The Magma Greatsword glows faintly. A single wave moves across the vertical ocean. The mirror suddenly closes. The desert returns to normal. CUT TO BLACK. No text. No title. No logo. CHARACTER CONTINUITY Preserve the exact reference appearance throughout. Ash Knight: exact armor, magma rune patterns, cape, proportions, silhouette and identity. Obsidian Rival: exact obsidian dragon-scale armor, horned helmet, orange visor, proportions, silhouette and identity. Magma Greatsword: exact blade geometry, jagged edges, handle, forged texture and red lava veins. No redesigns, identity drift, morphing, duplicates, weapon transformation, armor changes or flickering. ENVIRONMENT CONTINUITY One desert. One circular mirror. Same sunset. Same sand. Same weather. Same positions of the characters. The mirror's internal worlds may change, but the physical desert remains consistent. CINEMATOGRAPHY 24mm — vast desert. 35mm — character/environment compositions. 50mm — dramatic character shots. 85mm — mirror and sword details. Slow aerial descent. Lateral tracking. Controlled push-ins. Smooth crane movement. Subtle 60fps during the mirror fracture. Natural motion blur. Realistic sand interaction. Large-format cinematic depth. VISUAL DESIGN Golden desert. Deep blue-black shadows. Warm sunset. Black reflective mirror. Red magma glow. Cold futuristic architecture inside the mirror. Surreal vertical ocean. The color palette should evolve naturally rather than remaining monochromatic. NEGATIVE PROMPT text, subtitles, watermark, logo, modern clothing, cartoon, anime, low-poly, plastic armor, character redesign, identity drift, face morphing, weapon redesign, duplicate characters, extra limbs, malformed hands, inconsistent proportions, flickering, random camera movement, environment reset, inconsistent lighting, excessive destruction, graphic gore, blood, dismemberment, blurry subjects, flat lighting. DIRECTOR'S NOTE: Do not explain the mirror. The audience should discover its rules visually. The first reveal establishes that it shows the future; the second reveal breaks that assumption; the final reveal shows an entirely impossible world. The ending should leave the viewer with a question rather than an answer.
```

— [Emma](https://x.com/Emmma__0) · [source](https://x.com/Emmma__0/status/2090293905531314653) · Aug 20, 2026 · [gallery](https://youmind.com/en-US/seedance-2-0-prompts?id=9484)

---

### 9. Realistic Wing Chun Kung Fu Training Video

**20s** · **9:16** · 1113 words · **needs reference images**

> ⚠️ Requires: Image 1 — the practitioner — not included in the source repo.

Best engineering in the corpus. Decomposes the one-inch punch into five mandatory stages with an explicit anti-shortcut clause ('no starting with a fist, no pulling back, no skipping the clench'), plus a ramp-down/ramp-up rhythm map and a hard director-constraints block.

```text
[Style] Photorealistic Wing Chun Film, high-energy Douyin action video, Ramp-mo rhythm transitions, High-Speed Photography, 4K cinematic quality, realistic skin, sweat, and wood textures, no anime feel, no magic effects. [Duration] 20 seconds. [Aspect Ratio] 9:16 vertical screen. [Scene] Traditional old Lingnan martial arts hall, dark wood floors, mottled gray walls, wooden lattice windows; morning sunlight streaming in from the side, tiny dust motes floating in the air. A traditional solid wood wooden dummy is fixed in the center of the frame, with a cylindrical body, three wooden arms, and one slanted wooden leg. [Character] Wing Chun practitioner as per Image 1. Face, features, hairstyle, body proportions, and original clothing must strictly follow the image, maintaining the same person and look throughout. [Audio] No dialogue, no subtitles; emphasize the sound of dummy collisions, footsteps rubbing, short breaths, and the sound of wood splintering at the end. [00:00-00:04] Shot 1: Opening high-speed dummy striking (Impact Hook). The first frame enters high-speed action directly without environmental setup. Close-up side shot: The protagonist is rapidly practicing on the wooden dummy, hands continuously performing Tan Sau, Bong Sau, Pak Sau, palm strikes, and short punches around the centerline; hands switch rapidly between the three wooden arms, causing the arms to vibrate continuously. The camera tracks horizontally close to the protagonist's hands (Close Tracking), with hands flashing past the lens with natural motion blur; each strike produces different wood sounds. Cut to a low-angle full-body shot: The protagonist uses tight small steps to bypass the slanted leg of the dummy, upper body remains stable, feet do not cross, no large jumps. The final palm strike lands heavily in the center, the whole dummy shakes violently, dust falls, but no cracks appear. [00:04-00:08] Shot 2: Sudden deceleration · Precise slow practice (Ramp Down). After the final strike, all sound suddenly goes quiet, transitioning to slow motion. Side-front medium shot: The protagonist slows down, left hand against the upper arm, slowly dissolving outward; right hand delivers a short straight punch along the center of the dummy, retracting quickly after contact. The protagonist continues slowly performing Bong Sau, Pak Sau, and palm strikes, each movement clearly separated, arms short and close to the body, elbows not excessively flared. The camera orbits the protagonist and dummy about 90 degrees (Slow Orbit), showing the palm brushing the rough wood grain, slight vibration of the wooden arms, and sweat dripping down the cheek. The protagonist's gaze is locked on the center of the dummy, shoulders relaxed, lips slightly closed, breathing steady; observing distance and rhythm rather than angry flailing. [00:08-00:12] Shot 3: Slow to fast · Progressive acceleration. Low drum beats enter, the practice speed increases layer by layer. First set: Moderate speed, left hand dissolves arm, right palm strikes center. Second set: Visibly faster, Bong Sau to Pak Sau, followed by two short punches. Third set: Highest speed, left and right hands alternate rapidly, punches and palms crossing along the centerline, combined with small turns and ground-hugging footwork to the side of the dummy. Low-angle Steadicam Orbit from behind to the side-front; foreground wooden arms flash past, background windows and sunlight form slight speed trails. Movement gets faster, but the body doesn't sway, face remains steady, only breathing becomes heavier and gaze more focused. The dummy vibrates constantly with dense wood sounds, remaining intact. [00:12-00:14] Shot 4: Sudden stop · Locking on the dummy (Sudden Silence). After the high-speed combo, hands suddenly stop. All drums, strikes, and camera movement stop simultaneously. Fixed front medium shot: The protagonist stands before the dummy, feet unmoving, left hand retracted to chest, right hand hanging naturally. The dummy is still vibrating slightly, a few wood chips fall. Close-up of face: The protagonist slowly lifts eyes, locking gaze on the center of the dummy; lips tighten slightly, taking a deep breath. The scene remains quiet, pausing for the final one-inch punch. [00:14-00:17] Shot 5: Open palm approach · Clenching fist to store energy (Open Palm to Fist). Side medium-close shot: The protagonist slowly raises the right hand, fingers fully spread, palm facing the center of the dummy. Must clearly show a fully open palm first, not a fist. Body stable, right hand approaches the dummy very slowly; as the palm gets closer, the camera follows. Extreme Close-up: The open palm stops about one inch from the dummy, not touching, fingers naturally extended, palm, knuckles, and rough wood grain clearly visible. After a short pause, the fist clenches: pinky curls first, then ring and middle, index follows, thumb finally presses down. Fingers tighten completely from open palm to vertical fist. During clenching, the arm must not pull back; the distance remains one inch. Muscles and veins in the forearm tighten slightly, shoulders down, body doesn't lean forward. Sound is only skin friction and slow inhalation. [00:17-00:20] Shot 6: One-Inch Punch impact · Dummy shatters (One-Inch Punch). Extreme side close-up: The clenched right fist is one inch from the center. Still for 0.3s. Protagonist exhales sharply, the fist impacts from the close distance instantly; no pulling back, no big swing, moves only a few centimeters, clean hit. The impact must be a short, fast, concentrated explosion: Open palm approaches -> fingers clench -> store energy in place -> sudden impact from one inch. Do not combine into a normal punch. A heavy bang at contact. The dummy vibrates violently, radial cracks appear at the hit point; the thick body shatters into pieces, arms and leg fall off. Super Slow-mo for the shatter: Morning light illuminates flipping chips and heavy wood blocks falling with crack and thud sounds. No fire, smoke, or energy waves. Protagonist's fist remains at the center, body stable, not falling forward or bouncing back. Final 0.6s returns to normal speed: protagonist retracts fist, returns to Man Sau position, calmly watching the debris. Slow Pull-back to a frame of protagonist, shattered dummy, debris, and morning dust. [One-Inch Punch Hard Requirements] Must be split into 5 stages: 1. Fully open palm. 2. Approach slowly. 3. Stop at one inch. 4. Fingers clench sequentially and store energy. 5. Sudden impact. Must see the process of open palm and clenching. No starting with a fist, no pulling back, no skipping the clench, no long-distance punch, no hitting early, must pause after clenching before impact. [Director Constraints] Only one protagonist, strictly follow Image 1. Dummy always has 3 arms, 1 leg. Dummy stays intact until 17s. No boxing swings, hooks, big wind-ups, flying kicks, or acrobatics. No clipping through wood. No extra fingers, missing fingers, or deformations. No magic effects, glowing fists, shockwaves, or manga lines. No glass/foam/rubber texture for wood. No shouting or celebrating. No other characters, dialogue, titles, logos, or watermarks.
```

— [John](https://x.com/johnAGI168) · [source](https://x.com/johnAGI168/status/2089581545262551073) · Aug 18, 2026 · [gallery](https://youmind.com/en-US/seedance-2-0-prompts?id=9363)

---

### 10. Gym Vlog Continuous Dialogue

**15s** · 251 words · text-only

Solves one narrow problem well: unbroken speech across a 15s clip. Dialogue written out verbatim per beat, with 'no silent moments and no voice-over' stated twice as a guard.

```text
15-Second Gym Vlog — Continuous Dialogue

Character: The same young adult woman throughout the entire video, wearing a black T-shirt and sporty gym pants. Keep her face, hairstyle, outfit, and appearance consistent from beginning to end.

Scene: A realistic modern gym vlog. From the very first frame, the woman is already talking directly to the camera while walking through the gym. She keeps speaking continuously throughout the entire 15-second video—no silent moments and no voice-over.

0–5 sec: She walks toward the camera in selfie-vlog style, smiling naturally and talking directly to the viewer. Gym equipment and people working out are visible in the background.

Dialogue:

"Hey guys! I'm at the gym today, and I'm going to show you a little bit of my workout."

5–10 sec: While continuing to talk, she reaches the dumbbell area, picks up a moderate-sized dumbbell with one hand, briefly lifts it in a natural demonstration, and keeps speaking to the camera.

Dialogue:

"I usually start with some simple exercises like this, just to get warmed up."

10–15 sec: Still holding the dumbbell briefly, she looks at the camera and continues talking with a friendly smile, then places it back naturally.

Dialogue:

"Alright, let's get started and make this workout a good one!"

Important: Continuous talking from start to finish, natural lip-sync matching every word, no narration, no sudden cuts, no change of character or clothing. The same reference character must remain consistent throughout. Realistic gym environment, natural body movement, handheld smartphone vlog style, cinematic 4K quality.
```

— [Noor](https://x.com/noorlewisx) · [source](https://x.com/noorlewisx/status/2089573549044568375) · Aug 18, 2026 · [gallery](https://youmind.com/en-US/seedance-2-0-prompts?id=9344)

---

## Attribution

All prompts are the work of their listed authors, collected by [YouMind-OpenLab](https://github.com/YouMind-OpenLab/awesome-seedance-2-prompts) under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Prompt text is reproduced verbatim; the selection, tagging, and notes are the only additions. Same licence applies here.

Note: the example videos archived by the source repo are downscaled, **audio-stripped** proxies (~200-930 kbps, no audio track), so they can't demonstrate the audio direction these prompts specify. The gallery links have the full versions.
