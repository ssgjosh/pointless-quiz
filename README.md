# Pointless - Family Quiz Night

A TV-friendly quiz game where players aim for the **lowest score** - just like the show! Scores are generated from real Wikipedia pageview data, making every answer genuinely "pointless" (or not).

## Quick Start

1. **Install dependencies** (only needed for pack builder):
   ```bash
   npm install
   ```

2. **Start the game server**:
   ```bash
   npm start
   ```
   This opens the game at `http://localhost:8080`

3. **Cast to your TV**: Open Chrome, click the three dots menu → "Cast" → select your TV

## How to Play

### The Basics
- Each round shows a category (e.g., "Name a country in the European Union")
- Players take turns giving answers
- **Lower scores are better** - the goal is to find obscure correct answers
- A score of **0** means you found a "pointless" answer!
- Wrong answers, repeated answers, or passing = **100 points**
- The player with the **lowest total** at the end wins

### Hosting the Game
1. One person acts as the "host" with the laptop
2. Cast the screen to your TV so everyone can see
3. Type each player's answer and use autocomplete to confirm it
4. The game handles scoring automatically

### Keyboard Shortcuts
| Key | Action |
|-----|--------|
| `→` | Next player |
| `Enter` | Submit answer |
| `Backspace` | Undo last reveal |
| `N` | Next round |
| `M` | Mute/unmute |
| `F` | Fullscreen |
| `?` | Show shortcuts |

## Included Packs

### UK General Knowledge
- EU Countries
- US States
- African Countries
- World Capitals
- Chemical Elements
- UK Counties
- European Countries
- South American Countries
- Asian Countries
- London Boroughs

### Pop Culture
- Beatles Songs
- Disney Animated Films
- James Bond Films
- Oscar Best Picture Winners
- Shakespeare Plays
- Queen Songs
- Marvel Cinematic Universe Films
- Harry Potter Characters
- Charles Dickens Novels
- Pixar Films
- Agatha Christie Novels

## How Scoring Works

Scores are based on **real Wikipedia pageview data**:

1. For each answer in a category, we fetch how many times its Wikipedia article was viewed
2. We apply a logarithmic scale (so mega-famous items don't dominate)
3. We normalize to 0-100 within the category
4. The **bottom 10%** of answers get 0 points (pointless!)

This means:
- Popular answers (France, The Beatles, Iron Man) score high (80-100)
- Obscure answers (Malta, Rubidium, Timon of Athens) score low (0-10)
- The most obscure ~10% are genuinely "pointless" (0 points)

## Creating Custom Packs

### Using the Pack Builder

The pack builder fetches live data from Wikipedia/Wikidata to generate packs:

1. Create a YAML category definition file:

```yaml
title: "My Custom Pack"
version: 1
categories:
  - id: my_category
    prompt: "Name a thing from this category"
    sparql: |
      SELECT ?item ?itemLabel ?article ?image WHERE {
        ?item wdt:P31 wd:Q12345.
        OPTIONAL { ?item wdt:P18 ?image. }
        OPTIONAL { ?article schema:about ?item; schema:isPartOf <https://en.wikipedia.org/>. }
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
      }
    scoring:
      metric: "wikipedia_pageviews"
      window_days: 365
      pointless_percentile: 10
    images:
      enabled: true
```

2. Run the pack builder:
```bash
npm run build-pack categories/my-pack.yaml
```

3. The pack will be saved to `packs/my-custom-pack/pack.json`

### SPARQL Query Tips

Wikidata SPARQL queries let you fetch structured data. Common patterns:

```sparql
# Countries in a region
?item wdt:P31 wd:Q6256.  # is a country
?item wdt:P30 wd:Q46.     # in Europe (Q15=Africa, Q48=Asia, etc.)

# Members of an organization
?item wdt:P463 wd:Q458.   # member of EU

# Works by a creator
?item wdt:P50 wd:Q692.    # author is Shakespeare
?item wdt:P31 wd:Q7725634. # is a novel

# Films in a series
?item wdt:P179 wd:Q2783.  # part of James Bond series

# Getting images
?item wdt:P18 ?image.     # main image
?item wdt:P41 ?flag.      # flag (for countries)
```

Test queries at: https://query.wikidata.org/

### Manual Packs

You can also create packs manually without the builder:

```json
{
  "title": "My Pack",
  "version": 1,
  "categories": [
    {
      "id": "my_category",
      "prompt": "Name a thing",
      "answers": [
        { "text": "Popular Thing", "points": 90 },
        { "text": "Medium Thing", "points": 45 },
        { "text": "Obscure Thing", "points": 0, "aliases": ["Alternative Name"] }
      ]
    }
  ]
}
```

Save to `packs/my-pack/pack.json` and it will appear in the game.

## Data Sources & Attribution

All data comes from freely available public sources:

- **[Wikidata](https://www.wikidata.org/)** - Structured knowledge database (CC0)
- **[Wikipedia Pageviews API](https://wikimedia.org/api/rest_v1/)** - Real popularity data
- **[Wikimedia Commons](https://commons.wikimedia.org/)** - Free-licensed images

Images from Wikimedia Commons are used under their respective Creative Commons licenses. Attribution is shown in-game via the info button and credits screen.

## Technical Details

### Project Structure
```
pointless/
├── index.html          # Main game app
├── css/
│   └── styles.css      # TV-friendly styling
├── js/
│   ├── game.js         # Game engine
│   └── sounds.js       # Web Audio sound effects
├── pack-builder/
│   └── index.js        # CLI for generating packs
├── categories/
│   ├── uk-general.yaml # Category definitions
│   └── pop-culture.yaml
├── packs/
│   ├── uk-general-knowledge/
│   │   └── pack.json   # Generated pack
│   └── pop-culture/
│       └── pack.json
└── package.json
```

### Sound Effects

All sounds are synthesized using the Web Audio API - no external audio files needed. This ensures the game works offline and avoids licensing issues.

### Browser Support

Works in all modern browsers (Chrome, Firefox, Safari, Edge). For the best TV experience, use Chrome with Chromecast or screen mirroring.

## Tips for a Great Quiz Night

1. **Dim the lights** - makes the TV feel more theatrical
2. **Assign a dedicated host** - someone who won't play, just operates the game
3. **Allow discussion** - let players think out loud, it's more fun!
4. **Celebrate pointless answers** - they're rare and exciting
5. **Use the timer** - 30 seconds keeps things moving
6. **Take breaks** - play 5 rounds, grab snacks, continue

## License

MIT License - feel free to use, modify, and share!

---

*Inspired by the TV show format. This is a fan project using only publicly available data.*
