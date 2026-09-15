export type OwnerHintRule = {
  pattern: string;
  owners: string[];
};

export type FileOwnerHint = {
  file: string;
  pattern: string;
  owners: string[];
};

function cleanToken(value: string) {
  return value.trim().replace(/^["'`]+|["'`,.;]+$/g, "");
}

function looksLikePathPattern(value: string) {
  return /[/*.]|^[\w-]+\/[\w-]+/.test(value)
    && !value.startsWith("!")
    && !value.includes("\\")
    && !value.split("/").some((segment) => segment === "." || segment === "..");
}

function fallbackOwners(notes: string) {
  const match = notes.match(/\bOwners?:\s*([^\n.;]+)/i);
  if (!match?.[1]) {
    return [];
  }
  return splitOwners(match[1]).slice(0, 4);
}

function splitOwners(value: string) {
  return value
    .split(/[,\s]+/)
    .map(cleanToken)
    .filter((item) => item.length > 0 && /^@?[A-Za-z0-9][A-Za-z0-9._/-]*(?:@[A-Za-z0-9.-]+)?$/.test(item))
    .slice(0, 6);
}

function addRule(rules: OwnerHintRule[], pattern: string, owners: string[]) {
  const cleanPattern = cleanToken(pattern).replace(/^\.\//, "").replace(/^\//, "");
  const cleanOwners = owners.map(cleanToken).filter(Boolean);
  if (!cleanPattern || cleanPattern.length > 500 || cleanOwners.length === 0 || !looksLikePathPattern(cleanPattern)) {
    return;
  }
  if (!rules.some((rule) => rule.pattern === cleanPattern && rule.owners.join(",") === cleanOwners.join(","))) {
    rules.push({ pattern: cleanPattern, owners: cleanOwners });
  }
}

export function parseOwnerHintRules(notes?: string | null): OwnerHintRule[] {
  const text = notes?.trim();
  if (!text) {
    return [];
  }

  const rules: OwnerHintRule[] = [];
  const fallback = fallbackOwners(text);

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, "").trim().replace(/^(?:-|\*)\s+/, "");
    if (!line) {
      continue;
    }

    const codeowners = line.match(/\bCODEOWNERS?:\s*([^.;\n]+)/i)?.[1];
    const candidate = codeowners ?? line;
    const arrow = candidate.match(/^(\S+)\s*(?:->|:)\s*(.+)$/);
    if (arrow?.[1] && arrow[2]) {
      addRule(rules, arrow[1], splitOwners(arrow[2]));
      continue;
    }

    const parts = candidate.split(/\s+/).map(cleanToken).filter(Boolean);
    if (parts.length >= 2) {
      addRule(rules, parts[0], splitOwners(parts.slice(1).join(" ")));
      continue;
    }

    if (parts.length === 1 && codeowners && fallback.length > 0) {
      addRule(rules, parts[0], fallback);
    }
  }

  return rules.slice(0, 20);
}

export function inspectOwnerHintRules(notes?: string | null) {
  const text = notes?.trim() ?? "";
  const rules = parseOwnerHintRules(text);
  const candidateLines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+#.*$/, "").trim().replace(/^(?:-|\*)\s+/, ""))
    .filter((line) => line && !line.startsWith("#") && !/^Owners?:/i.test(line));

  return {
    rules,
    candidateCount: candidateLines.length,
    invalidLines: candidateLines.filter((line) => {
      const parsedLine = parseOwnerHintRules(line);
      return parsedLine.length === 0;
    }).slice(0, 10),
  };
}

function patternToRegExpSource(pattern: string) {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "*") {
      if (pattern[index + 1] === "*") {
        source += ".*";
        index += 1;
      } else {
        source += "[^/]*";
      }
      continue;
    }
    source += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  }
  return source;
}

function patternMatchesFile(pattern: string, file: string) {
  const cleanPattern = pattern.replace(/^\//, "");
  const cleanFile = file.replace(/^\.\//, "").replace(/^\//, "");
  if (cleanPattern.endsWith("/**")) {
    const prefix = cleanPattern.slice(0, -3).replace(/\/$/, "");
    return cleanFile === prefix || cleanFile.startsWith(`${prefix}/`);
  }
  if (!cleanPattern.includes("*")) {
    return cleanFile === cleanPattern || cleanFile.startsWith(`${cleanPattern.replace(/\/$/, "")}/`);
  }

  return new RegExp(`^${patternToRegExpSource(cleanPattern)}$`).test(cleanFile);
}

function isSafeRelativeFile(file: string) {
  return file.length > 0
    && file.length <= 1000
    && !file.startsWith("/")
    && !file.includes("\\")
    && !/[\u0000-\u001f\u007f]/.test(file)
    && !file.split("/").some((segment) => segment === "." || segment === "..");
}

export function ownerHintsForFiles(files: string[], notes?: string | null): FileOwnerHint[] {
  const rules = parseOwnerHintRules(notes);
  if (rules.length === 0) {
    return [];
  }

  return files
    .map((file) => {
      if (!isSafeRelativeFile(file)) {
        return null;
      }
      const rule = [...rules].reverse().find((candidate) => patternMatchesFile(candidate.pattern, file));
      return rule ? { file, pattern: rule.pattern, owners: rule.owners } : null;
    })
    .filter((hint): hint is FileOwnerHint => Boolean(hint));
}
