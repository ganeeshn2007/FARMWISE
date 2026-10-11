import { ai, db, admin } from "hatchable";

export const access = "admin";
export const methods = ["POST"];

function clean(v, max = 12000) { return v == null ? "" : String(v).trim().slice(0, max); }
function parseJson(value) {
  const s = String(value || "").trim().replace(/^\x60{3}(?:json)?/i, "").replace(/\x60{3}$/, "").trim();
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("invalid_model_json");
  return JSON.parse(s.slice(a, b + 1));
}

export default async function (req, res) {
  if (!await admin.check(req)) return res.status(403).json({ available: false, error: "admin_only", message: "Only the FarmWise project owner can create draft knowledge records." });
  const body = req.body || {};
  const kind = clean(body.kind, 20).toLowerCase();
  const sourceName = clean(body.sourceName, 200);
  const sourceUrl = clean(body.sourceUrl, 1000);
  const sourceText = clean(body.sourceText, 12000);
  const cropHint = clean(body.crop, 100);
  const region = clean(body.region, 120);
  if (!["disease", "crop"].includes(kind) || !sourceName || !/^https:\/\//i.test(sourceUrl) || sourceText.length < 100) {
    return res.status(400).json({ available: false, error: "missing_source_material", message: "Provide kind (disease or crop), sourceName, HTTPS sourceUrl, and at least 100 characters of sourceText. Paste source text from a trusted agricultural source; the model does not verify URLs by itself." });
  }
  const schema = kind === "disease"
    ? '{"crop_name":"","disease_name":"","symptoms":"Only source-supported symptoms; mention differential uncertainty","treatment_guidance":"Conservative summary of source-supported integrated management; no invented chemical rates","notes":"Limitations and context of source"}'
    : '{"crop_name":"","region":"","season":"","soil_type":"","ph_min":null,"ph_max":null,"nitrogen_min_mg_kg":null,"nitrogen_max_mg_kg":null,"phosphorus_min_mg_kg":null,"phosphorus_max_mg_kg":null,"potassium_min_mg_kg":null,"potassium_max_mg_kg":null,"moisture_min_pct":null,"moisture_max_pct":null,"guidance":"","notes":"Limitations and context of source"}';
  const prompt = "Convert the supplied agricultural source excerpt into exactly one conservative structured database draft. Do not use outside knowledge, invent facts, ranges, or chemical doses. If a numeric requirement is not explicitly in the excerpt, use null. Every statement must be traceable to the excerpt. This is NOT verified; human agricultural review is required. Kind: " + kind + ". Crop hint: " + (cropHint || "not supplied") + ". Region hint: " + (region || "not supplied") + ". Source name: " + sourceName + ". Source URL: " + sourceUrl + ". Return JSON only using this shape: " + schema + ". Source excerpt:\n" + sourceText;
  try {
    const generated = await ai.generateText({ model: "gemini-flash", prompt, purpose: "farmwise-draft-agricultural-knowledge", maxSteps: 1 });
    const d = parseJson(generated.text);
    if (kind === "disease") {
      const crop = clean(d.crop_name, 120), disease = clean(d.disease_name, 160);
      if (!crop || !disease || !clean(d.symptoms, 20) || !clean(d.treatment_guidance, 20)) throw new Error("incomplete_disease_record");
      const q = await db.query("INSERT INTO disease_references (crop_name,disease_name,symptoms,treatment_guidance,source_name,source_url,verified_status,notes) VALUES ($1,$2,$3,$4,$5,$6,'needs_review',$7) RETURNING id,crop_name,disease_name,verified_status,source_name,source_url", [crop,disease,clean(d.symptoms,2000),clean(d.treatment_guidance,3000),sourceName,sourceUrl,clean(d.notes,1500) + " AI-generated draft from supplied excerpt; reviewer must verify source and local applicability."]);
      return res.status(201).json({ available: true, kind, record: q.rows[0], message: "Saved as needs_review. It is not eligible for recommendations until an agricultural reviewer verifies it." });
    }
    const crop = clean(d.crop_name, 120), guidance = clean(d.guidance, 3000);
    if (!crop || !guidance) throw new Error("incomplete_crop_record");
    const fields = ["ph_min","ph_max","nitrogen_min_mg_kg","nitrogen_max_mg_kg","phosphorus_min_mg_kg","phosphorus_max_mg_kg","potassium_min_mg_kg","potassium_max_mg_kg","moisture_min_pct","moisture_max_pct"];
    const nums = fields.map(k => d[k] == null || d[k] === "" ? null : Number(d[k]));
    if (nums.some(n => n !== null && (!Number.isFinite(n) || n < 0))) throw new Error("invalid_numeric_range");
    if ((nums[0] !== null && nums[1] !== null && nums[0] > nums[1]) || (nums[8] !== null && nums[9] !== null && (nums[8] > nums[9] || nums[9] > 100))) throw new Error("invalid_range_order");
    const q = await db.query("INSERT INTO crop_knowledge (crop_name,region,season,soil_type,ph_min,ph_max,nitrogen_min_mg_kg,nitrogen_max_mg_kg,phosphorus_min_mg_kg,phosphorus_max_mg_kg,potassium_min_mg_kg,potassium_max_mg_kg,moisture_min_pct,moisture_max_pct,guidance,source_name,source_url,verified_status,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'needs_review',$18) RETURNING id,crop_name,region,season,verified_status,source_name,source_url", [crop,clean(d.region || region,120)||null,clean(d.season,80)||null,clean(d.soil_type,120)||null,...nums,guidance,sourceName,sourceUrl,clean(d.notes,1500) + " AI-generated draft from supplied excerpt; reviewer must verify source, units, and local applicability."]);
    return res.status(201).json({ available: true, kind, record: q.rows[0], message: "Saved as needs_review. It is not eligible for recommendations until an agricultural reviewer verifies it." });
  } catch (e) {
    console.error("FarmWise knowledge draft failed", String(e).slice(0,200));
    return res.status(422).json({ available: false, error: "draft_generation_failed", message: "Could not create a valid draft from the supplied source. No record was saved; check the excerpt and try again." });
  }
}