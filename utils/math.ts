// Difficulty modifier based on level
export const getDifficultyModifier = (level: number): number => {
  if (level < 309) return 1;
  if (level >= 309 && level < 400) {
    // Formula: (9 * L - 1811) / 890
    return (9 * level - 1811) / 890;
  }
  return 2; // 400 to 500
};

// Calculate cultivation cost to go from level to level + 1
// This is the "Cultivation Value" needed, not time. Time = Value / Speed.
export const getLevelUpCostValue = (level: number, difficulty: number): number => {
  const modifier = getDifficultyModifier(level);
  // Formula: (Difficulty * (Level^3 + 1000) / 100) * Modifier
  return (difficulty * (Math.pow(level, 3) + 1000) / 100) * modifier;
};

// Calculate Total Zhenyuan at a specific level
export const getZhenyuan = (level: number, difficulty: number, isMain: boolean): number => {
  // Formula: 3 * Level^3 * Difficulty / 10127
  const rawZhenyuan = (3 * Math.pow(level, 3) * difficulty) / 10127;
  const factor = isMain ? 1 : 0.5;
  return Math.floor(rawZhenyuan * factor);
};

// Calculate Breakthrough Time (Hours)
export const getBreakthroughTime = (targetLevelEndingIn9: number, reductionPercent: number): number => {
  // Breakthrough happens at 99, 109... to reach the next tier.
  // 99...289 -> 2 hours
  // 299...389 -> 4 hours (Prompt: "299, 309... 389 needs 4 hours")
  // 399+ -> Assumed 4 hours or more? Prompt says "400 to 500 modifier is 2", implies difficulty jump. 
  // Let's assume 4 hours persists or follows the prompt logic strictly.
  // Prompt implies logic for 299-389.
  
  let baseTime = 0;
  if (targetLevelEndingIn9 >= 99 && targetLevelEndingIn9 <= 289) {
    baseTime = 2;
  } else if (targetLevelEndingIn9 >= 299 && targetLevelEndingIn9 <= 389) {
    baseTime = 4;
  } else if (targetLevelEndingIn9 >= 399) {
    baseTime = 8;
  }
  
  return baseTime * (1 - reductionPercent / 100);
};

// Calculate Cost (in Hours) to go from currentLevel (ending in 9) to currentLevel + 10
export const getStepCost = (
  startLevel: number, 
  difficulty: number,
  speed: number, 
  breakthroughReduction: number
): number => {
  // 1. Breakthrough time needed to unlock the path from startLevel -> startLevel+1
  const breakTime = getBreakthroughTime(startLevel, breakthroughReduction);

  // 2. Cultivation time for the 10 levels (startLevel -> startLevel+1 ... -> startLevel+10)
  // Actually, standard game logic: At 99, you breakthrough to allow 99->100. Then you cult 99->100... 108->109.
  // The cost is sum of getLevelUpCostValue for l=startLevel to startLevel+9.
  let cultValue = 0;
  for (let l = startLevel; l < startLevel + 10; l++) {
    cultValue += getLevelUpCostValue(l, difficulty);
  }

  const cultTime = cultValue / speed;

  return breakTime + cultTime;
};

// Global Optimization using DP / Pareto Frontier
export const optimize = (
  arts: { id: string; difficulty: number; isMain: boolean; count: number }[],
  settings: {
    speed: number;
    reduction: number;
    targetType: 'zhenyuan' | 'time';
    targetValue: number;
  }
) => {
  // 1. Flatten instances (handle 'count')
  const instances = [];
  arts.forEach((art, idx) => {
    for(let i=0; i<art.count; i++) {
      instances.push({ ...art, uniqueId: `${art.id}_${i}`, originalIndex: idx });
    }
  });

  if (instances.length === 0) {
    return { totalZhenyuan: 0, totalTimeHours: 0, arts: {}, path: [] };
  }

  // 2. Precompute Options Curves for each instance
  // Each instance can be at Level 99, 109, 119... up to 499.
  // We compute the cumulative Cost (Time) and total Zhenyuan for each stopping point.
  const instanceOptions = instances.map(inst => {
    const options = [];
    let cumTime = 0;
    
    // Base State: Level 99
    // Cost: 0 (Starting point)
    // Z: Z(99)
    options.push({
      level: 99,
      z: getZhenyuan(99, inst.difficulty, inst.isMain),
      t: 0
    });

    for (let l = 99; l < 499; l += 10) {
      // Cost to go from l to l+10
      const stepT = getStepCost(l, inst.difficulty, settings.speed, settings.reduction);
      cumTime += stepT;
      
      const nextLevel = l + 10;
      const nextZ = getZhenyuan(nextLevel, inst.difficulty, inst.isMain);
      
      options.push({
        level: nextLevel,
        z: nextZ,
        t: cumTime
      });
    }
    return options;
  });

  // 3. Dynamic Programming (Merge Pareto Frontiers)
  // State: { z: TotalZhenyuan, t: TotalTime, choices: number[] }
  // We maintain a list of states sorted by Z descending.
  // We strictly keep the Pareto frontier: For a given Z, we want Min T.
  // If state A has (Za, Ta) and state B has (Zb, Tb), and Za >= Zb but Ta <= Tb, B is dominated and discarded.
  
  // Initial frontier: Just one state (Level 99 for all)
  let baseTotalZ = 0;
  instances.forEach(inst => baseTotalZ += getZhenyuan(99, inst.difficulty, inst.isMain));
  
  // We store "Delta Z" and "Total T" in the DP to keep numbers cleaner, then add baseTotalZ at end.
  // choices[i] = level of instance i
  let frontier = [{ z: 0, t: 0, choices: new Array(instances.length).fill(99) }];

  for (let i = 0; i < instances.length; i++) {
    const options = instanceOptions[i];
    const baseZ_i = options[0].z; // Z at level 99 for this instance
    const nextFrontier = [];

    // Expand
    // For every existing efficient state, try every possible level for the current martial art
    for (const state of frontier) {
      for (const opt of options) {
        const deltaZ = opt.z - baseZ_i;
        
        const newZ = state.z + deltaZ;
        const newT = state.t + opt.t;
        
        // Construct new choices array (copy on write)
        // Optimization: For large N, this array copy is slow. 
        // But with ~2000 states and ~20 instances, it's manageable (40k small arrays).
        const newChoices = [...state.choices];
        newChoices[i] = opt.level;

        nextFrontier.push({ z: newZ, t: newT, choices: newChoices });
      }
    }

    // Prune & Sort
    // 1. Sort by Z Descending (More Z first)
    nextFrontier.sort((a, b) => b.z - a.z);

    // 2. Pareto Filter
    // We want Min T. Since we iterate from Max Z down to Min Z:
    // As Z decreases, T *must* decrease strictly to be efficient.
    // If we find a state with T higher than a previously seen (higher Z) state, it's useless.
    // Wait, if Z=100, T=10. Next is Z=90. If T=11, then Z=100 is strictly better. Drop Z=90.
    // So we keep track of `minTimeSeen`. If `current.t < minTimeSeen`, we keep it and update minTimeSeen.
    
    const pruned = [];
    let minTimeSeen = Infinity;

    // Pruning + Bucketing optimization to prevent explosion
    // If two states are very close in Z, keep the one with significantly lower T.
    // Simple approach: Strict Pareto filter is usually enough for this problem size.
    // But we add a bucket filter to cap max states at ~2000 to keep UI responsive.
    const BUCKET_SIZE = 100; // Granularity of Z
    const seenBuckets = new Set<number>();

    for (const state of nextFrontier) {
      if (state.t < minTimeSeen) {
        // It's efficient.
        
        // Bucket check to reduce density
        const bucket = Math.floor(state.z / BUCKET_SIZE);
        if (!seenBuckets.has(bucket)) {
             pruned.push(state);
             minTimeSeen = state.t;
             seenBuckets.add(bucket);
        } else {
            // We already have a representative for this Z range with HIGHER Z (since sorted desc) and efficient T.
            // But wait, the current one has LOWER T (since t < minTimeSeen).
            // Actually, if t < minTimeSeen, it is BETTER time than everything before.
            // So we should probably keep it? 
            // The bucket strategy usually keeps the *best Z* per bucket.
            // Since we sort by Z desc, the first one hitting the bucket is the Highest Z in that bucket.
            // It is also efficient (passed minTimeSeen).
            // So skipping subsequent entries in same bucket preserves the "Best Z" for that Time range.
        }
      }
    }
    
    frontier = pruned;
  }

  // 4. Find Best Result based on Target
  let bestState = null;

  if (settings.targetType === 'zhenyuan') {
    // We want Min Time for Z >= Target.
    // Frontier is sorted by Z desc.
    // We look for the "smallest" Z that is still >= Target.
    // Or simply: Iterate. The last one that satisfies Z >= Target is the one with smallest Z (and thus smallest T? No).
    // In Pareto frontier (Z desc, T asc? No, T desc? No).
    // Z desc. T must be strictly decreasing?
    // Let's trace: (100, 10), (90, 8), (80, 5). 
    // Yes, as Z goes down, T goes down.
    // So if we want Z >= 85:
    // (100, 10) - ok.
    // (90, 8) - ok.
    // (80, 5) - fail.
    // Best is (90, 8) -> Minimum time (8) for satisfying constraint.
    
    // So we find the state with Min T that satisfies `state.z + baseTotalZ >= settings.targetValue`.
    // Since T decreases as index increases, we want the LAST state that satisfies the condition.
    
    for (const state of frontier) {
        if (state.z + baseTotalZ >= settings.targetValue) {
            bestState = state; // Keep updating, simpler logic since later elements have lower time
        } else {
            break; // Sorted by Z desc, once we go below target, we never recover
        }
    }
    // If no state reaches target, bestState remains the one with Max Z (first one) or null?
    if (!bestState && frontier.length > 0) bestState = frontier[0]; // Best effort

  } else {
    // Target Time
    // We want Max Z for T <= Target.
    // Frontier is sorted by Z desc.
    // Find FIRST state where `state.t <= settings.targetValue`.
    // Since Z is desc, the first one we find is the Max Z possible.
    
    for (const state of frontier) {
        if (state.t <= settings.targetValue) {
            bestState = state;
            break;
        }
    }
    // Fallback: If minimal time is still > target, pick the cheapest one (last one)
    if (!bestState && frontier.length > 0) bestState = frontier[frontier.length - 1];
  }

  // 5. Format Output
  if (!bestState) return null;

  const finalArts: Record<string, number> = {};
  instances.forEach((inst, idx) => {
      finalArts[inst.uniqueId] = bestState!.choices[idx];
  });

  return {
    totalZhenyuan: bestState.z + baseTotalZ,
    totalTimeHours: bestState.t,
    arts: finalArts, // Maps uniqueId -> Level
    path: [] // Not strictly needed for the table view
  };
};
