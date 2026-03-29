function buildPrompt(teams) {
  return [
    'You are a cricket analyst. Score IPL T20 teams built from auction picks.',
    '',
    'Return ONLY valid JSON (no markdown, no code fences).',
    'Schema:',
    '{',
    '  "teams": [',
    '    {',
    '      "participantId": number,',
    '      "teamName": string,',
    '      "score": number,',
    '      "summary": string,',
    '      "strengths": string[],',
    '      "risks": string[],',
    '      "breakdown": {',
    '        "battingDepth": number,',
    '        "paceBowling": number,',
    '        "spinBowling": number,',
    '        "allRounders": number,',
    '        "wicketKeeping": number,',
    '        "powerplay": number,',
    '        "deathOvers": number,',
    '        "overallBalance": number',
    '      },',
    '      "assumptions": string',
    '    }',
    '  ]',
    '}',
    '',
    'Scoring rules:',
    '- score must be 0..100 (integer).',
    '- breakdown values must be 0..10 (integer).',
    '- Use the provided category/roles, and general real-world player knowledge if you have it.',
    '- If unsure about a player, say so in assumptions and still produce a best-effort score.',
    '',
    'Teams input (Main XI only):',
    JSON.stringify(teams),
  ].join('\n');
}

function extractJson(text) {
  if (!text) throw new Error('Empty Gemini response');

  const trimmed = String(text).trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return JSON.parse(trimmed);
  }

  const firstBrace = trimmed.indexOf('{');
  const firstBracket = trimmed.indexOf('[');
  let start = -1;
  if (firstBrace === -1) start = firstBracket;
  else if (firstBracket === -1) start = firstBrace;
  else start = Math.min(firstBrace, firstBracket);

  if (start === -1) {
    throw new Error('Gemini did not return JSON');
  }

  const lastBrace = trimmed.lastIndexOf('}');
  const lastBracket = trimmed.lastIndexOf(']');
  const end = Math.max(lastBrace, lastBracket);
  if (end === -1 || end <= start) {
    throw new Error('Gemini JSON boundaries not found');
  }

  const slice = trimmed.slice(start, end + 1);
  return JSON.parse(slice);
}

async function generateTeamScores({ apiKey, model, teams }) {
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set on the server');
  }

  const geminiModel = model || 'gemini-1.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const prompt = buildPrompt(teams);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 1200,
      },
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error?.message || `Gemini request failed (${response.status})`;
    throw new Error(message);
  }

  const text = payload?.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join('\n') || '';
  const parsed = extractJson(text);

  return {
    model: geminiModel,
    rawText: text,
    parsed,
  };
}

module.exports = {
  generateTeamScores,
};
