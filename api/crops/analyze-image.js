import { ai, db } from "hatchable";

export const access = "public";
export const methods = ["POST"];

function clean(v, max=120) {
  return v == null ? "" : String(v).trim().slice(0,max);
}
function jsonFromText(text) {
  const s = String(text || "").trim().replace(/^\x60{3}(?:json)?/i,"").replace(/\x60{3}$/,"").trim();
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("model_json_missing");
  return JSON.parse(s.slice(a,b+1));
}
export default async function(req,res) {
  const body = req.body || {};
  const imageData = typeof body.imageData === "string" ? body.imageData : "";
  const cropHint = clean(body.crop, 80);
  const context = clean(body.context, 500);
  const match = imageData.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return res.status(400).json({available:false,error:"invalid_image",message:"Upload a JPG, PNG or WEBP image."});
  if (match[2].length > 8_000_000) return res.status(413).json({available:false,error:"image_too_large",message:"Image is too large. Use a photo under about 5 MB."});
  const mimeType = match[1], data = match[2];
  const prompt = `You are assisting an agricultural extension worker. Examine the attached photo carefully. This is differential screening, NOT a definitive laboratory diagnosis. User crop hint: ${cropHint || "not provided"}. Additional context: ${context || "none"}.
Return ONLY valid JSON with this exact shape:
{"isAgriculturalImage":true,"crop":"best identification or Unknown","imageQuality":"good|limited|poor","observations":["visible evidence only"],"candidates":[{"name":"candidate disease/pest or Healthy/abiotic stress/uncertain","likelihood":"high|moderate|low","relativeScore":0,"why":"visible evidence and uncertainty","management":["practical management step"],"prevention":["prevention step"]}],"nextStep":"safe practical next step","needsExpertReview":true}
Include a variable number of plausible differential candidates (1 to 10 depending on the image; do not pad the list). If the photo is not clearly a crop/plant, set isAgriculturalImage=false and candidates=[]. Do not invent symptoms that are not visible. relativeScore is only a relative model estimate, not a calibrated statistical probability; do not imply accuracy validation. For each candidate, provide 2 to 4 crop-relevant, lower-risk management steps and 1 to 3 prevention steps. Prioritize integrated pest management, sanitation, removing severely affected material when appropriate, drainage or irrigation adjustments only when supported by evidence, monitoring, and local extension review. Do not recommend pesticide names, dosages, or spray schedules. Do not promise a cure. Distinguish disease from nutrient deficiency, water stress, pest damage, and healthy appearance. If uncertain, label the advice conditional on confirming the diagnosis.`;
  try {
    const r = await ai.fetch({
      provider: "google",
      path: "/v1beta/models/gemini-3.8-flash:generateContent",
      body: { contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType, data } }] }], generationConfig: { responseMimeType: "application/json", temperature: 0.1 } },
      purpose: "farmwise-plant-photo-screening",
      timeoutMs: 45000
    });
    if (!r.ok) {
      const detail = String(r.error || "");
      if (r.status === 412) return res.status(412).json({available:false,error:"ai_setup_required",message:"Plant photo analysis is not enabled yet. Configure a Google AI provider in Hatchable Setup, then retry."});
      console.error("FarmWise vision provider failed", {status:r.status, detail:detail.slice(0,200)});
      return res.status(502).json({available:false,error:"vision_provider_unavailable",message:"The plant-photo analysis provider is unavailable. No diagnosis was produced."});
    }
    const raw = await r.json();
    const modelText = (raw.candidates?.[0]?.content?.parts || []).map(p=>p.text || "").join("\n");
    const result = jsonFromText(modelText);
    if (typeof result.isAgriculturalImage !== "boolean" || !Array.isArray(result.candidates)) throw new Error("model_shape_invalid");
    result.candidates = result.candidates.slice(0,10).map(c=>({
      name:clean(c.name,100) || "Uncertain",
      likelihood:["high","moderate","low"].includes(c.likelihood)?c.likelihood:"low",
      relativeScore:Number.isFinite(Number(c.relativeScore))?Math.max(0,Math.min(100,Number(c.relativeScore))):null,
      why:clean(c.why,400),
      management:Array.isArray(c.management)?c.management.slice(0,4).map(v=>clean(v,300)).filter(Boolean):[],
      prevention:Array.isArray(c.prevention)?c.prevention.slice(0,3).map(v=>clean(v,300)).filter(Boolean):[]
    }));
    result.observations = Array.isArray(result.observations) ? result.observations.slice(0,8).map(v=>clean(v,200)) : [];
    result.crop = clean(result.crop,80) || "Unknown";
    result.imageQuality = ["good","limited","poor"].includes(result.imageQuality) ? result.imageQuality : "limited";
    result.nextStep = clean(result.nextStep,500);
    result.fetchedAt = new Date().toISOString();
    result.source = "Google Gemini vision screening; not a validated crop-specific classifier";
    result.confidenceNote = "Relative scores are model estimates, not calibrated probabilities or validated accuracy.";
    // Attach matching PostgreSQL treatment records, preserving the real review status.
    // Needs-review entries may be displayed as provisional references, never as verified advice.
    for (const c of result.candidates) {
      c.databaseReferences = [];
      try {
        const q = await db.query(
          "SELECT crop_name,disease_name,treatment_guidance,source_name,source_url,source_published_at,verified_status FROM disease_references WHERE verified_status IN ('verified','reviewed','needs_review') AND lower(disease_name) LIKE '%' || lower($1) || '%' AND ($2 = 'Unknown' OR lower(crop_name) LIKE '%' || lower($2) || '%') ORDER BY CASE verified_status WHEN 'verified' THEN 0 WHEN 'reviewed' THEN 1 ELSE 2 END, disease_name LIMIT 3",
          [c.name.slice(0,80), result.crop]
        );
        c.databaseReferences = q.rows;
        c.verifiedReferences = q.rows; // backwards compatibility for older front-end drafts
      } catch (_) {}
    }
    return res.json({available:true,result});
  } catch (e) {
    const errText = String(e);
    console.error("FarmWise photo analysis failed", errText.slice(0,180));
    if (/412|no google key configured|setup_required/i.test(errText)) {
      return res.status(412).json({available:false,error:"ai_setup_required",message:"Photo analysis needs a Google AI provider key. Add it in Hatchable Setup; no diagnosis was produced."});
    }
    return res.status(502).json({available:false,error:"photo_analysis_failed",message:"The photo could not be analyzed. Try a clearer close-up or retry later. No diagnosis was produced."});
  }
}