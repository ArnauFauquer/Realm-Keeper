// What a new sheet's builder offers to start from: a sheet per game system,
// one for a character and one for an adversary, in the JSON a document keeps
// (backend/models/sheet.py SheetBody). Each is only a starting point, laid
// out the way that game's sheets are: the author renames, adds and removes
// from there. Numbers are a plausible first-level example, so the rolls and
// the way modifiers are written show for themselves.

const HP = '#fb7185'
const STRESS = '#f472b6'
const HOPE = '#fbbf24'
const MAGIC = '#60a5fa'
const SANITY = '#22d3ee'

const mod = (n) => (n < 0 ? `${n}` : `+${n}`)
const d20 = (n) => (n ? `1d20${mod(n)}` : '1d20')
/** A skill as a row: its name, and the roll at the end. */
const skillRow = (name, n) => ({ name, roll: d20(n) })

// ── Generic ─────────────────────────────────────────────────────────────

const generic = {
  character: {
    sections: [
      {
        counters: [
          { name: 'HP', max: 10 },
          { name: 'Stress', max: 5, start: 0 }
        ],
        stats: [{ stats: [{ label: 'Defense', value: 10 }] }]
      },
      {
        title: 'Actions',
        items: [{ name: 'Attack', roll: '1d20+3' }]
      }
    ]
  },
  adversary: {
    sections: [
      {
        counters: [
          { name: 'HP', max: 6 },
          { name: 'Stress', max: 3, start: 0 }
        ],
        stats: [{ stats: [{ label: 'Difficulty', value: 12 }] }]
      },
      {
        title: 'Actions',
        items: [{ name: 'Attack', roll: '1d20+3', text: 'What it does. Dice in text work too, like `1d8+2`.' }]
      }
    ]
  }
}

// ── Dungeons & Dragons 5e ───────────────────────────────────────────────

// The standard array, as a fighter would place it.
const DND_ABILITIES = [
  ['STR', 15],
  ['DEX', 14],
  ['CON', 13],
  ['INT', 12],
  ['WIS', 10],
  ['CHA', 8]
]
const dndMod = (score) => Math.floor((score - 10) / 2)
const dndAbility = Object.fromEntries(DND_ABILITIES.map(([key, score]) => [key, dndMod(score)]))
const DND_PROFICIENCY = 2
const DND_SKILLS = [
  ['Acrobatics', 'DEX'],
  ['Animal Handling', 'WIS'],
  ['Arcana', 'INT'],
  ['Athletics', 'STR', true],
  ['Deception', 'CHA'],
  ['History', 'INT'],
  ['Insight', 'WIS'],
  ['Intimidation', 'CHA', true],
  ['Investigation', 'INT'],
  ['Medicine', 'WIS'],
  ['Nature', 'INT'],
  ['Perception', 'WIS', true],
  ['Performance', 'CHA'],
  ['Persuasion', 'CHA'],
  ['Religion', 'INT'],
  ['Sleight of Hand', 'DEX'],
  ['Stealth', 'DEX'],
  ['Survival', 'WIS']
]
const DND_SAVES = ['STR', 'CON']

const dnd5e = {
  character: {
    subtitle: 'Level 1 · Class, Species, Background',
    sections: [
      {
        wide: true,
        counters: [
          { name: 'HP', max: 12, color: HP, style: 'bar' },
          { name: 'Temp HP', max: 20, start: 0, style: 'number' },
          { name: 'Hit Dice', max: 1 },
          { name: 'Heroic Inspiration', max: 1, start: 0, color: HOPE },
          { name: 'Death Save Successes', max: 3, start: 0 },
          { name: 'Death Save Failures', max: 3, start: 0, color: HP }
        ],
        stats: [
          {
            columns: 5,
            stats: [
              { label: 'Armor Class', value: 16 },
              { label: 'Initiative', value: mod(dndAbility.DEX), roll: d20(dndAbility.DEX) },
              { label: 'Speed', value: '30 ft' },
              { label: 'Proficiency', value: mod(DND_PROFICIENCY) },
              { label: 'Passive Perception', value: 10 + dndAbility.WIS + DND_PROFICIENCY }
            ]
          }
        ]
      },
      {
        title: 'Abilities',
        wide: true,
        stats: [
          {
            title: 'Ability checks',
            columns: 6,
            stats: DND_ABILITIES.map(([key, score]) => ({
              label: key,
              value: `${score} (${mod(dndMod(score))})`,
              roll: d20(dndMod(score))
            }))
          },
          {
            title: 'Saving throws',
            columns: 6,
            stats: DND_ABILITIES.map(([key]) => {
              const bonus = dndAbility[key] + (DND_SAVES.includes(key) ? DND_PROFICIENCY : 0)
              return { label: key, value: mod(bonus), roll: d20(bonus) }
            })
          }
        ]
      },
      {
        title: 'Skills',
        tab: 'Skills',
        columns: 2,
        items: DND_SKILLS.map(([name, ability, proficient]) =>
          skillRow(`${name} (${ability})`, dndAbility[ability] + (proficient ? DND_PROFICIENCY : 0))
        )
      },
      {
        title: 'Weapons',
        tab: 'Combat',
        items: [
          {
            name: 'Longsword',
            roll: d20(dndAbility.STR + DND_PROFICIENCY),
            tags: ['Melee', 'Versatile'],
            text: `Hit: \`1d8${mod(dndAbility.STR)}\` slashing damage (\`1d10${mod(dndAbility.STR)}\` with two hands).`
          },
          {
            name: 'Light Crossbow',
            roll: d20(dndAbility.DEX + DND_PROFICIENCY),
            tags: ['Ranged', '80/320 ft'],
            text: `Hit: \`1d8${mod(dndAbility.DEX)}\` piercing damage.`
          }
        ]
      },
      {
        title: 'Class features',
        tab: 'Features',
        items: [
          { name: 'Second Wind', cost: 'Bonus action', text: 'Regain `1d10+1` HP. Twice per long rest.' },
          { name: 'Feature', text: 'What it does, and how often it can be used.' }
        ]
      },
      {
        title: 'Feats & traits',
        tab: 'Features',
        items: [{ name: 'Species trait', text: 'Darkvision, a resistance, a once-per-rest power...' }]
      },
      {
        title: 'Spellcasting',
        tab: 'Spells',
        counters: [
          { name: 'Level 1 Slots', max: 2, color: MAGIC }
        ],
        stats: [
          {
            columns: 3,
            stats: [
              { label: 'Ability', value: 'INT' },
              { label: 'Save DC', value: 8 + DND_PROFICIENCY + dndAbility.INT },
              { label: 'Spell attack', value: mod(DND_PROFICIENCY + dndAbility.INT), roll: d20(DND_PROFICIENCY + dndAbility.INT) }
            ]
          }
        ],
        items: [
          { name: 'Cantrip', tags: ['Cantrip'], text: 'What it does.' },
          { name: 'Spell', tags: ['Level 1'], cost: 'Action', text: 'Range, duration and effect.' }
        ]
      },
      {
        title: 'Equipment',
        tab: 'Gear',
        stats: [
          {
            title: 'Coins',
            columns: 5,
            stats: [
              { label: 'CP', value: 0 },
              { label: 'SP', value: 0 },
              { label: 'EP', value: 0 },
              { label: 'GP', value: 10 },
              { label: 'PP', value: 0 }
            ]
          }
        ],
        items: [
          { name: 'Chain Mail', tags: ['Armor'], text: 'AC 16. Disadvantage on Stealth.' },
          { name: "Explorer's Pack", text: 'Backpack, bedroll, rations, rope, tinderbox, torches, waterskin.' }
        ]
      }
    ],
    text: 'Personality, ideals, bonds, flaws and backstory.'
  },
  adversary: {
    subtitle: 'Medium Humanoid · CR 1/2 (100 XP)',
    sections: [
      {
        wide: true,
        counters: [{ name: 'HP', max: 16, color: HP, style: 'bar' }],
        stats: [
          {
            columns: 4,
            stats: [
              { label: 'AC', value: 13 },
              { label: 'Initiative', value: '+1', roll: '1d20+1' },
              { label: 'Speed', value: '30 ft' },
              { label: 'Proficiency', value: '+2' }
            ]
          },
          {
            columns: 6,
            stats: [
              { label: 'STR', value: '13 (+1)', roll: '1d20+1' },
              { label: 'DEX', value: '12 (+1)', roll: '1d20+1' },
              { label: 'CON', value: '12 (+1)', roll: '1d20+1' },
              { label: 'INT', value: '10 (+0)', roll: '1d20' },
              { label: 'WIS', value: '11 (+0)', roll: '1d20' },
              { label: 'CHA', value: '10 (+0)', roll: '1d20' }
            ]
          },
          {
            stats: [
              { label: 'Skills', value: 'Athletics +3, Perception +2' },
              { label: 'Senses', value: 'Passive Perception 12' },
              { label: 'Languages', value: 'Common' }
            ]
          }
        ]
      },
      {
        title: 'Traits',
        items: [{ name: 'Trait', text: 'Something it always does or always is.' }]
      },
      {
        title: 'Actions',
        items: [
          {
            name: 'Scimitar',
            roll: '1d20+3',
            text: '*Melee Attack Roll:* +3, reach 5 ft. *Hit:* `1d6+1` slashing damage.'
          },
          {
            name: 'Shortbow',
            roll: '1d20+3',
            text: '*Ranged Attack Roll:* +3, range 80/320 ft. *Hit:* `1d6+1` piercing damage.'
          }
        ]
      },
      {
        title: 'Reactions',
        collapsed: true,
        items: [{ name: 'Parry', text: '*Trigger:* a melee attack hits it. *Response:* +2 AC against that attack.' }]
      }
    ]
  }
}

// ── Daggerheart ─────────────────────────────────────────────────────────

// The trait spread every character starts from: +2, +1, +1, +0, +0, -1.
const DH_TRAITS = [
  ['Agility', 2],
  ['Strength', 1],
  ['Finesse', 1],
  ['Instinct', 0],
  ['Presence', 0],
  ['Knowledge', -1]
]
const duality = (n) => (n ? `hf${mod(n)}` : 'hf')

const daggerheart = {
  character: {
    subtitle: 'Level 1 · Class, Ancestry, Community',
    sections: [
      {
        wide: true,
        counters: [
          { name: 'HP', max: 6, color: HP },
          { name: 'Stress', max: 6, start: 0, color: STRESS },
          { name: 'Hope', max: 6, start: 2, color: HOPE },
          { name: 'Armor Slots', max: 4, start: 0 }
        ],
        stats: [
          {
            columns: 4,
            stats: [
              { label: 'Evasion', value: 10 },
              { label: 'Armor', value: 4 },
              { label: 'Thresholds', value: '8 / 16' },
              { label: 'Proficiency', value: 1 }
            ]
          },
          {
            title: 'Traits',
            columns: 6,
            stats: DH_TRAITS.map(([label, n]) => ({ label, value: mod(n), roll: duality(n) }))
          }
        ]
      },
      {
        title: 'Experiences',
        columns: 2,
        items: [
          { name: 'Experience', cost: '+2' },
          { name: 'Experience', cost: '+2' }
        ]
      },
      {
        title: 'Weapons',
        tab: 'Combat',
        items: [
          {
            name: 'Longsword',
            roll: duality(2),
            tags: ['Primary', 'Agility', 'Melee', 'Two-Handed'],
            text: 'Damage `1d10+3` physical.'
          },
          { name: 'Secondary weapon', tags: ['Secondary'], text: 'Trait, range and damage.' }
        ]
      },
      {
        title: 'Armor',
        tab: 'Combat',
        items: [{ name: 'Chainmail Armor', tags: ['Heavy'], text: 'Base thresholds 7 / 15. Base score 4. -1 to Evasion.' }]
      },
      {
        title: 'Class & subclass',
        tab: 'Features',
        items: [
          { name: 'Hope feature', cost: '3 Hope', text: 'What spending Hope on it does.' },
          { name: 'Class feature', text: 'What it does.' },
          { name: 'Foundation feature', tags: ['Subclass'], text: 'What it does.' }
        ]
      },
      {
        title: 'Heritage',
        tab: 'Features',
        items: [
          { name: 'Ancestry feature', tags: ['Ancestry'], text: 'What it does.' },
          { name: 'Community feature', tags: ['Community'], text: 'What it does.' }
        ]
      },
      {
        title: 'Loadout',
        tab: 'Domain cards',
        columns: 2,
        items: [
          { name: 'Domain card', tags: ['Domain', 'Level 1'], cost: 'Recall 1', text: 'What it does.' },
          { name: 'Domain card', tags: ['Domain', 'Level 1'], cost: 'Recall 0', text: 'What it does.' }
        ]
      },
      {
        title: 'Inventory',
        tab: 'Gear',
        stats: [
          {
            title: 'Gold',
            columns: 3,
            stats: [
              { label: 'Handfuls', value: 1 },
              { label: 'Bags', value: 0 },
              { label: 'Chest', value: 0 }
            ]
          }
        ],
        items: [
          { name: 'Minor Health Potion', text: 'Clear `1d4` HP.' },
          { name: 'Torch, rope, basic supplies' }
        ]
      }
    ],
    text: 'Background questions and connections with the rest of the party.'
  },
  adversary: {
    subtitle: 'Tier 1 · Standard',
    sections: [
      {
        wide: true,
        counters: [
          { name: 'HP', max: 5, color: HP },
          { name: 'Stress', max: 3, start: 0, color: STRESS }
        ],
        stats: [
          {
            columns: 3,
            stats: [
              { label: 'Difficulty', value: 12 },
              { label: 'Thresholds', value: '7 / 13' },
              { label: 'Attack', value: '+1', roll: '1d20+1' }
            ]
          },
          {
            stats: [
              { label: 'Motives & tactics', value: 'Ambush, hunt in packs, protect its territory' },
              { label: 'Experience', value: 'Tracker +2' }
            ]
          }
        ]
      },
      {
        title: 'Standard attack',
        items: [{ name: 'Claws', roll: '1d20+1', tags: ['Melee'], text: '`1d8+2` physical damage.' }]
      },
      {
        title: 'Features',
        items: [
          { name: 'Feature', tags: ['Passive'], text: 'Something that is always true of it.' },
          { name: 'Feature', tags: ['Action'], cost: 'Mark a Stress', text: 'Something the GM can spend a spotlight on.' },
          { name: 'Feature', tags: ['Reaction'], text: 'When something happens, what it does.' }
        ]
      }
    ]
  }
}

// ── Pathfinder 2e ───────────────────────────────────────────────────────

const PF_LEVEL = 1
const PF_ATTRIBUTES = [
  ['Str', 4],
  ['Dex', 2],
  ['Con', 2],
  ['Int', 0],
  ['Wis', 1],
  ['Cha', 0]
]
const pfAttribute = Object.fromEntries(PF_ATTRIBUTES)
// Untrained adds nothing; trained, expert, master and legendary add the
// character's level and 2, 4, 6 or 8.
const PF_RANK = { U: null, T: 2, E: 4, M: 6, L: 8 }
const pfBonus = (attribute, rank) => pfAttribute[attribute] + (PF_RANK[rank] === null ? 0 : PF_LEVEL + PF_RANK[rank])
const PF_SKILLS = [
  ['Acrobatics', 'Dex', 'T'],
  ['Arcana', 'Int', 'U'],
  ['Athletics', 'Str', 'T'],
  ['Crafting', 'Int', 'U'],
  ['Deception', 'Cha', 'U'],
  ['Diplomacy', 'Cha', 'U'],
  ['Intimidation', 'Cha', 'T'],
  ['Lore (Warfare)', 'Int', 'T'],
  ['Medicine', 'Wis', 'U'],
  ['Nature', 'Wis', 'U'],
  ['Occultism', 'Int', 'U'],
  ['Performance', 'Cha', 'U'],
  ['Religion', 'Wis', 'U'],
  ['Society', 'Int', 'U'],
  ['Stealth', 'Dex', 'U'],
  ['Survival', 'Wis', 'T'],
  ['Thievery', 'Dex', 'U']
]
const pfStrike = pfBonus('Str', 'E')

const pathfinder2e = {
  character: {
    subtitle: 'Level 1 · Class, Ancestry, Background',
    sections: [
      {
        wide: true,
        counters: [
          { name: 'HP', max: 20, color: HP, style: 'bar' },
          { name: 'Temp HP', max: 20, start: 0, style: 'number' },
          { name: 'Hero Points', max: 3, start: 1, color: HOPE },
          { name: 'Dying', max: 4, start: 0, color: HP },
          { name: 'Wounded', max: 3, start: 0 }
        ],
        stats: [
          {
            columns: 4,
            stats: [
              { label: 'AC', value: 18 },
              { label: 'Perception', value: mod(pfBonus('Wis', 'E')), roll: d20(pfBonus('Wis', 'E')) },
              { label: 'Class DC', value: 10 + pfBonus('Str', 'T') },
              { label: 'Speed', value: '25 ft' }
            ]
          },
          {
            title: 'Saving throws',
            columns: 3,
            stats: [
              { label: 'Fortitude', value: mod(pfBonus('Con', 'E')), roll: d20(pfBonus('Con', 'E')) },
              { label: 'Reflex', value: mod(pfBonus('Dex', 'E')), roll: d20(pfBonus('Dex', 'E')) },
              { label: 'Will', value: mod(pfBonus('Wis', 'T')), roll: d20(pfBonus('Wis', 'T')) }
            ]
          },
          {
            title: 'Attribute modifiers',
            columns: 6,
            stats: PF_ATTRIBUTES.map(([label, n]) => ({ label, value: mod(n) }))
          }
        ]
      },
      {
        title: 'Skills',
        tab: 'Skills',
        columns: 2,
        items: PF_SKILLS.map(([name, attribute, rank]) => ({
          ...skillRow(name, pfBonus(attribute, rank)),
          tags: rank === 'U' ? [] : [rank]
        }))
      },
      {
        title: 'Strikes',
        tab: 'Combat',
        items: [
          {
            name: 'Longsword',
            roll: d20(pfStrike),
            tags: ['Melee', 'Versatile P'],
            cost: '1 action',
            text: `Damage \`1d8${mod(pfAttribute.Str)}\` slashing.`
          },
          { name: 'Longsword, 2nd attack', roll: d20(pfStrike - 5) },
          { name: 'Longsword, 3rd attack', roll: d20(pfStrike - 10) }
        ]
      },
      {
        title: 'Actions & reactions',
        tab: 'Combat',
        items: [
          { name: 'Raise a Shield', cost: '1 action', text: '+2 circumstance bonus to AC until your next turn.' },
          { name: 'Reaction', cost: 'Reaction', text: '*Trigger:* when it happens. *Effect:* what it does.' }
        ]
      },
      {
        title: 'Feats',
        tab: 'Feats',
        items: [
          { name: 'Ancestry feat', tags: ['Ancestry', '1'], text: 'What it does.' },
          { name: 'Background feat', tags: ['Skill', '1'], text: 'What it does.' },
          { name: 'Class feat', tags: ['Class', '1'], text: 'What it does.' }
        ]
      },
      {
        title: 'Spells',
        tab: 'Spells',
        counters: [
          { name: 'Focus Points', max: 1, color: MAGIC },
          { name: 'Rank 1 Slots', max: 2, color: MAGIC }
        ],
        stats: [
          {
            columns: 2,
            stats: [
              { label: 'Spell DC', value: 10 + pfBonus('Int', 'T') },
              { label: 'Spell attack', value: mod(pfBonus('Int', 'T')), roll: d20(pfBonus('Int', 'T')) }
            ]
          }
        ],
        items: [
          { name: 'Cantrip', tags: ['Cantrip'], cost: '2 actions', text: 'Range, targets and effect.' },
          { name: 'Spell', tags: ['Rank 1'], cost: '2 actions', text: 'Range, targets and effect.' }
        ]
      },
      {
        title: 'Inventory',
        tab: 'Gear',
        stats: [
          {
            title: 'Coins',
            columns: 4,
            stats: [
              { label: 'CP', value: 0 },
              { label: 'SP', value: 0 },
              { label: 'GP', value: 15 },
              { label: 'PP', value: 0 }
            ]
          },
          { stats: [{ label: 'Bulk', value: '4 / 9' }] }
        ],
        items: [
          { name: 'Chain Mail', tags: ['Armor'], cost: 'Bulk 2' },
          { name: "Adventurer's Pack", cost: 'Bulk 1' }
        ]
      }
    ],
    text: 'Heritage, deity, background story and notes.'
  },
  adversary: {
    subtitle: 'Creature 1',
    tags: ['Medium', 'Humanoid'],
    sections: [
      {
        wide: true,
        counters: [{ name: 'HP', max: 20, color: HP, style: 'bar' }],
        stats: [
          {
            columns: 6,
            stats: [
              { label: 'Perception', value: '+7', roll: '1d20+7' },
              { label: 'AC', value: 16 },
              { label: 'Fort', value: '+7', roll: '1d20+7' },
              { label: 'Ref', value: '+5', roll: '1d20+5' },
              { label: 'Will', value: '+4', roll: '1d20+4' },
              { label: 'Speed', value: '25 ft' }
            ]
          },
          {
            columns: 6,
            stats: [
              { label: 'Str', value: '+3' },
              { label: 'Dex', value: '+1' },
              { label: 'Con', value: '+2' },
              { label: 'Int', value: '+0' },
              { label: 'Wis', value: '+1' },
              { label: 'Cha', value: '+0' }
            ]
          },
          {
            stats: [
              { label: 'Skills', value: 'Athletics +7, Intimidation +5' },
              { label: 'Languages', value: 'Common' }
            ]
          }
        ]
      },
      {
        title: 'Strikes',
        items: [
          {
            name: 'Shortsword',
            roll: '1d20+9',
            tags: ['Melee', 'Agile', 'Finesse'],
            cost: '1 action',
            text: 'Damage `1d6+3` piercing. Then +5, +1 (agile).'
          },
          { name: 'Shortbow', roll: '1d20+7', tags: ['Ranged', '60 ft'], cost: '1 action', text: 'Damage `1d6` piercing.' }
        ]
      },
      {
        title: 'Abilities',
        items: [
          { name: 'Ability', cost: 'Reaction', text: '*Trigger:* when it happens. *Effect:* what it does.' },
          { name: 'Ability', cost: '2 actions', text: 'What it does.' }
        ]
      }
    ]
  }
}

// ── Call of Cthulhu 7e ──────────────────────────────────────────────────

const COC_CHARACTERISTICS = [
  ['STR', 50],
  ['CON', 50],
  ['SIZ', 60],
  ['DEX', 55],
  ['APP', 50],
  ['INT', 70],
  ['POW', 65],
  ['EDU', 70]
]
const coc = Object.fromEntries(COC_CHARACTERISTICS)
/** A percentile value with its hard and extreme halves, as the sheet prints it. */
const percent = (value) => `${value} (${Math.floor(value / 2)}/${Math.floor(value / 5)})`
// The skills and their base chances.
const COC_SKILLS = [
  ['Accounting', 5],
  ['Anthropology', 1],
  ['Appraise', 5],
  ['Archaeology', 1],
  ['Art/Craft', 5],
  ['Charm', 15],
  ['Climb', 20],
  ['Credit Rating', 0],
  ['Cthulhu Mythos', 0],
  ['Disguise', 5],
  ['Dodge', Math.floor(coc.DEX / 2)],
  ['Drive Auto', 20],
  ['Elec. Repair', 10],
  ['Fast Talk', 5],
  ['Fighting (Brawl)', 25],
  ['Firearms (Handgun)', 20],
  ['Firearms (Rifle)', 25],
  ['First Aid', 30],
  ['History', 5],
  ['Intimidate', 15],
  ['Jump', 20],
  ['Language (Other)', 1],
  ['Language (Own)', coc.EDU],
  ['Law', 5],
  ['Library Use', 20],
  ['Listen', 20],
  ['Locksmith', 1],
  ['Mech. Repair', 10],
  ['Medicine', 1],
  ['Natural World', 10],
  ['Navigate', 10],
  ['Occult', 5],
  ['Persuade', 10],
  ['Pilot', 1],
  ['Psychology', 10],
  ['Ride', 5],
  ['Science', 1],
  ['Sleight of Hand', 10],
  ['Spot Hidden', 25],
  ['Stealth', 20],
  ['Survival', 10],
  ['Swim', 20],
  ['Throw', 20],
  ['Track', 10]
]

const callOfCthulhu7e = {
  character: {
    subtitle: 'Occupation, age 30',
    sections: [
      {
        wide: true,
        counters: [
          { name: 'HP', max: Math.floor((coc.CON + coc.SIZ) / 10), color: HP },
          { name: 'Magic Points', max: Math.floor(coc.POW / 5), color: MAGIC, style: 'bar' },
          { name: 'Sanity', max: 99, start: coc.POW, color: SANITY, style: 'bar' },
          { name: 'Luck', max: 99, start: 50, color: HOPE, style: 'number' },
          { name: 'Major Wound', max: 1, start: 0, color: HP },
          { name: 'Temporary Insanity', max: 1, start: 0, color: SANITY }
        ],
        stats: [
          {
            title: 'Characteristics',
            columns: 4,
            stats: COC_CHARACTERISTICS.map(([label, value]) => ({ label, value: percent(value), roll: '1d100' }))
          },
          {
            columns: 4,
            stats: [
              { label: 'Damage Bonus', value: 'None' },
              { label: 'Build', value: 0 },
              { label: 'Move', value: 7 },
              { label: 'Dodge', value: percent(Math.floor(coc.DEX / 2)), roll: '1d100' }
            ]
          }
        ]
      },
      {
        title: 'Skills',
        tab: 'Skills',
        stats: [{ columns: 4, stats: COC_SKILLS.map(([label, value]) => ({ label, value, roll: '1d100' })) }]
      },
      {
        title: 'Weapons',
        tab: 'Combat',
        items: [
          {
            name: 'Unarmed',
            roll: '1d100',
            tags: ['Fighting (Brawl)'],
            text: 'Damage 1D3 + Damage Bonus. 1 attack per round.'
          },
          {
            name: '.38 Revolver',
            roll: '1d100',
            tags: ['Firearms (Handgun)', '15 yards'],
            text: 'Damage `1d10`. 1 (3) attacks per round. 6 shots. Malfunction 100.'
          }
        ]
      },
      {
        title: 'Backstory',
        tab: 'Backstory',
        columns: 2,
        items: [
          { name: 'Personal description', text: 'What people notice first.' },
          { name: 'Ideology & beliefs', text: 'What they hold to.' },
          { name: 'Significant people', text: 'Who matters to them, and why.' },
          { name: 'Meaningful locations', text: 'Where they feel at home.' },
          { name: 'Treasured possessions', text: 'What they would not leave behind.' },
          { name: 'Traits', text: 'How they act.' },
          { name: 'Injuries & scars' },
          { name: 'Phobias & manias' },
          { name: 'Arcane tomes & spells' },
          { name: 'Encounters with strange entities' }
        ]
      },
      {
        title: 'Gear & possessions',
        tab: 'Gear',
        stats: [
          {
            title: 'Cash & assets',
            columns: 3,
            stats: [
              { label: 'Spending level', value: '$10' },
              { label: 'Cash', value: '$40' },
              { label: 'Assets', value: '$1,000' }
            ]
          }
        ],
        items: [{ name: 'Flashlight' }, { name: 'Notebook and pencil' }]
      }
    ]
  },
  adversary: {
    subtitle: 'Monster',
    sections: [
      {
        wide: true,
        counters: [
          { name: 'HP', max: 16, color: HP },
          { name: 'Magic Points', max: 10, color: MAGIC, style: 'bar' }
        ],
        stats: [
          {
            columns: 6,
            stats: [
              { label: 'STR', value: 80, roll: '1d100' },
              { label: 'CON', value: 70, roll: '1d100' },
              { label: 'SIZ', value: 90, roll: '1d100' },
              { label: 'DEX', value: 50, roll: '1d100' },
              { label: 'INT', value: 40, roll: '1d100' },
              { label: 'POW', value: 50, roll: '1d100' }
            ]
          },
          {
            columns: 4,
            stats: [
              { label: 'Damage Bonus', value: '+1D6', roll: '1d6' },
              { label: 'Build', value: 2 },
              { label: 'Move', value: 8 },
              { label: 'Armor', value: '2 (thick hide)' }
            ]
          },
          {
            columns: 2,
            stats: [
              { label: 'Sanity Loss', value: '1/1D6', roll: '1d6' },
              { label: 'Attacks per round', value: 1 }
            ]
          }
        ]
      },
      {
        title: 'Combat',
        items: [
          { name: 'Fighting', roll: '1d100', cost: '50%', text: 'Damage `1d6` + Damage Bonus.' },
          { name: 'Dodge', roll: '1d100', cost: '25%' }
        ]
      },
      {
        title: 'Skills',
        items: [
          { name: 'Stealth', roll: '1d100', cost: '40%' },
          { name: 'Listen', roll: '1d100', cost: '50%' }
        ]
      },
      {
        title: 'Special powers',
        items: [{ name: 'Power', text: 'What it can do, and what it costs.' }]
      }
    ],
    text: 'What it is, where it lairs, and what the investigators learn of it.'
  }
}

/** The systems a new sheet can start from, in the order they are offered. */
export const SHEET_SYSTEMS = [
  {
    id: 'generic',
    name: 'Generic',
    icon: 'mdi-shape-outline',
    hint: { character: 'HP, Stress, Defense and an attack', adversary: 'HP, Stress, Difficulty and an attack' },
    templates: generic
  },
  {
    id: 'dnd5e',
    name: 'D&D 5e',
    icon: 'mdi-dice-d20-outline',
    hint: { character: 'Abilities, saves, skills, spell slots', adversary: 'Stat block: abilities, traits, actions' },
    templates: dnd5e
  },
  {
    id: 'daggerheart',
    name: 'Daggerheart',
    icon: 'mdi-sword-cross',
    hint: { character: 'Traits, Hope, Stress, domain cards', adversary: 'Difficulty, thresholds, features' },
    templates: daggerheart
  },
  {
    id: 'pf2e',
    name: 'Pathfinder 2e',
    icon: 'mdi-shield-sword-outline',
    hint: { character: 'Attributes, saves, ranked skills, strikes', adversary: 'Creature block: defenses, strikes' },
    templates: pathfinder2e
  },
  {
    id: 'coc7e',
    name: 'Call of Cthulhu 7e',
    icon: 'mdi-octagram-outline',
    hint: { character: 'Characteristics, Sanity, Luck, skills in %', adversary: 'Characteristics, Sanity loss, attacks' },
    templates: callOfCthulhu7e
  }
]

/** A fresh copy of a system's sheet for a character or an adversary. */
export function sheetTemplate(systemId, type) {
  const system = SHEET_SYSTEMS.find((s) => s.id === systemId)
  const template = system?.templates[type]
  return template ? structuredClone(template) : null
}
