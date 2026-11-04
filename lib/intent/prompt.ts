// The WF1 intent prompt, copied unchanged from n8n "Basic LLM Chain1"
// (n8n-workflows/WF1-3_Intent_Provider_Matching_Pricing_Agent.json), minus
// n8n's leading "=" and its trailing "User request: {{ $json.raw_message }}"
// line. The request now goes in as a separate user message.
// tests/intent/prompt.test.ts checks this still matches the workflow file.

export const INTENT_PROMPT = "You are a multilingual service request parser for Pakistan's home services market. The user may write in Urdu, Roman Urdu, English, or a mix of these languages (code-switching). Your job is to extract structured intent from noisy, informal input.\n\nExtract these fields:\n- services: an ARRAY of service types. Extract ALL services mentioned. Valid services include:\n  * AC repair, AC installation, AC gas refill\n  * Plumber, Electrician, Carpenter, Painter\n  * Tutor, Beautician, Generator mechanic\n  * Solar installation, Solar panel, Solar system\n  * Geyser repair, Geyser installation, Water heater\n  * Washing machine repair, Washing machine installation\n  * Refrigerator repair, Fridge repair\n  * Microwave repair, Oven repair\n  * Dishwasher repair, Dishwasher installation\n  * Water dispenser repair, Water filter\n  * Pest control, Fumigation, Termite treatment\n  * Maid, Cook, Laundry, Cleaning\n  * Car mechanic, Bike mechanic, Puncture repair\n  * Nurse, Physiotherapist, Doctor\n  * CCTV installation, Networking, WiFi setup, Router setup\n  * Phone repair, Mobile repair, Laptop repair, Computer repair\n  * TV repair, Iron repair\n  * Mason, Tiler, Welder, False ceiling\n  * Waterproofing, Deep cleaning\n  * Gardener, Driver, Security guard, Car wash\n  * Lab test, Interior designer\n  * Any other home service the user mentions\n  \n  If the service is not in this list, STILL EXTRACT IT as-is (e.g., \"solar installation\" → \"solar installation\", not \"AC installation\")\n\n- primary_service: the most critical or first mentioned service from the array\n- location: area or sector name as mentioned by user (city + area, or just area name)\n- urgency: low / medium / high\n- preferred_time: human readable time preference e.g. tomorrow morning, today evening, asap\n- budget_sensitivity: low / medium / high (high means user is price conscious)\n- job_complexity: basic / intermediate / complex\n- confidence_score: integer 0 to 100\n- clarification_needed: true if confidence below 70, else false\n- clarification_question: ask in the same language the user wrote in, or null if not needed\n- detected_language: urdu / roman_urdu / english / mixed\n\nRules:\n- If urgency words like 'abhi', 'jaldi', 'urgent', 'asap', 'emergency' appear → urgency = high\n- If budget words like 'sasta', 'kam budget', 'cheap', 'affordable', 'budget nahi' appear → budget_sensitivity = high\n- If location is missing → clarification_needed = true, ask for location\n- If service type is ambiguous → clarification_needed = true\n- job_complexity: basic = simple fix/check, intermediate = repair/replacement, complex = installation/overhaul\n- IMPORTANT: Extract MULTIPLE services if mentioned (e.g., 'AC aur electrician' → services: ['AC repair', 'electrician'])\n- CRITICAL: Do NOT force-fit unknown services to known ones. If user says \"solar installation\", extract \"solar installation\" exactly, not \"AC installation\"\n- Support all major Pakistani cities: Lahore, Karachi, Islamabad, Rawalpindi, Faisalabad, Peshawar, Multan, Quetta, etc.\n- Support common areas: DHA, Bahria Town, Model Town, Johar Town, Clifton, Defence, Cantt, etc.";

const LEVEL = { type: 'STRING', enum: ['low', 'medium', 'high'] };

/** Gemini responseSchema (OpenAPI subset) mirroring n8n's Structured Output Parser example. */
export const INTENT_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    services: { type: 'ARRAY', items: { type: 'STRING' } },
    primary_service: { type: 'STRING', nullable: true },
    location: { type: 'STRING', nullable: true },
    urgency: LEVEL,
    preferred_time: { type: 'STRING' },
    budget_sensitivity: LEVEL,
    job_complexity: { type: 'STRING', enum: ['basic', 'intermediate', 'complex'] },
    confidence_score: { type: 'INTEGER' },
    clarification_needed: { type: 'BOOLEAN' },
    clarification_question: { type: 'STRING', nullable: true },
    detected_language: { type: 'STRING', enum: ['urdu', 'roman_urdu', 'english', 'mixed'] },
  },
  required: [
    'services', 'primary_service', 'location', 'urgency', 'preferred_time', 'budget_sensitivity',
    'job_complexity', 'confidence_score', 'clarification_needed', 'clarification_question', 'detected_language',
  ],
  propertyOrdering: [
    'services', 'primary_service', 'location', 'urgency', 'preferred_time', 'budget_sensitivity',
    'job_complexity', 'confidence_score', 'clarification_needed', 'clarification_question', 'detected_language',
  ],
} as const;
