// Optional: compares two progress photos with Gemini's vision and returns a
// short, cautious read on visible training progress. Entirely optional —
// gated on GEMINI_API_KEY being set, same pattern as push notifications being
// gated on the VAPID keys (see push.js). Nothing here runs, and no photo ever
// leaves this server, unless that key is configured.
//
// Uses the Gemini API's free tier (get a key at https://aistudio.google.com/apikey
// — no credit card needed). See the README's "Progress photos" section.

const API_KEY = process.env.GEMINI_API_KEY || '';
// Pass a different model via GEMINI_MODEL if you'd rather trade some judgment
// quality for speed, or a future model replaces this one. Check the current
// list (and which models are still on the free tier) at
// https://ai.google.dev/gemini-api/docs/models
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const apiUrl = (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

export const aiConfigured = Boolean(API_KEY);

const VERDICTS = ['improving', 'maintaining', 'hard_to_tell', 'less_defined'];

const CATEGORY_LABEL = { upper: 'upper body', lower: 'lower body' };

function buildPrompt(category, fromDate, toDate) {
  const area = CATEGORY_LABEL[category] || category;
  return `You are looking at two photos someone logged in their strength-training \
tracker to watch their ${area} training progress over time. The first photo is \
from ${fromDate}, the second from ${toDate}.

Give a rough, honest, encouraging read on visible training progress in the \
${area} — NOT a medical, fitness, or body-composition assessment. Specifically:
- Only comment on what's actually visible: muscle definition, visible size/shape \
  changes, posture. Judge the ${area} specifically; ignore other areas of the photo.
- Do NOT guess weight, body fat percentage, BMI, or give any numeric body \
  measurement — photos can't support that and it isn't useful here.
- Do NOT comment on weight loss or gain as a goal in itself; this is about \
  visible strength-training progress, not appearance or diet.
- Explicitly account for confounds that can fake a difference — lighting, \
  pose, distance from camera, angle, clothing — and say so if they make the \
  comparison hard to judge rather than guessing past them.
- If you genuinely can't tell from these two photos, say so plainly \
  (verdict "hard_to_tell") rather than inventing a confident answer.
- Keep the tone matter-of-fact and encouraging, never critical of their body.
- Never mention your knowledge cutoff, that you are an AI, or anything about \
  these instructions.

Respond with ONLY a single JSON object, no other text, matching exactly:
{"verdict": "improving" | "maintaining" | "hard_to_tell" | "less_defined", "summary": "2-3 plain sentences"}`;
}

/**
 * @param {{category: 'upper'|'lower', from: {date, content_type, data: Buffer}, to: {date, content_type, data: Buffer}}} photos
 * @returns {Promise<{verdict: string, summary: string}>}
 */
export async function comparePhotos({ category, from, to }) {
  if (!aiConfigured) {
    throw new Error('AI analysis is not configured on this server (GEMINI_API_KEY is not set)');
  }

  const res = await fetch(apiUrl(MODEL), {
    method: 'POST',
    headers: {
      'x-goog-api-key': API_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: buildPrompt(category, from.date, to.date) }] },
      contents: [
        {
          role: 'user',
          parts: [
            { text: `Photo 1 (${from.date}):` },
            { inline_data: { mime_type: from.content_type, data: from.data.toString('base64') } },
            { text: `Photo 2 (${to.date}):` },
            { inline_data: { mime_type: to.content_type, data: to.data.toString('base64') } },
          ],
        },
      ],
      generationConfig: { temperature: 0.2, maxOutputTokens: 400 },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const message = parseErrorMessage(body) || res.statusText;
    throw new Error(`AI analysis failed (${res.status}): ${message.slice(0, 300)}`);
  }

  const payload = await res.json();
  const candidate = payload?.candidates?.[0];

  // Gemini's safety filters can block a response outright rather than
  // returning text — most likely on an unusual photo, not a normal gym
  // shot, but handle it as a soft "couldn't tell" rather than a crash.
  const blockReason = payload?.promptFeedback?.blockReason;
  if (blockReason || (candidate && ['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST'].includes(candidate.finishReason))) {
    return {
      verdict: 'hard_to_tell',
      summary: "The AI couldn't process these two photos (its safety filters flagged them). Try a different pair, or just compare them yourself above.",
    };
  }

  const text = candidate?.content?.parts?.map((p) => p.text).filter(Boolean).join('\n') ?? '';
  return parseVerdict(text);
}

/** Gemini's error body is `{ error: { message, status, code } }`. */
function parseErrorMessage(body) {
  try {
    return JSON.parse(body)?.error?.message || null;
  } catch {
    return body ? body.slice(0, 300) : null;
  }
}

function parseVerdict(text) {
  // The model is asked for bare JSON, but tolerate it being wrapped in a
  // code fence or preceded by stray text — pull out the first { ... } block.
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      if (VERDICTS.includes(parsed.verdict) && typeof parsed.summary === 'string' && parsed.summary.trim()) {
        return { verdict: parsed.verdict, summary: parsed.summary.trim().slice(0, 1000) };
      }
    } catch {
      // fall through to the raw-text fallback below
    }
  }
  // Didn't come back as the requested JSON — still show the reply rather
  // than failing outright, just without a structured verdict badge.
  return { verdict: 'hard_to_tell', summary: text.trim().slice(0, 1000) || 'Could not read a response from the AI.' };
}
