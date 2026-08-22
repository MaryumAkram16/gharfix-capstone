export const PLACEHOLDER_PREFIX = '[';
export const PLACEHOLDER_SUFFIX = ']';

export function isPlaceholder(val: string | null): boolean {
  if (!val) return true;
  return val.startsWith(PLACEHOLDER_PREFIX) && val.endsWith(PLACEHOLDER_SUFFIX);
}

export const i18nResponses = {
  english: {
    askService: "What service do you need? (e.g., Plumber, AC Repair, Electrician)",
    askCity: "Which city are you located in? (e.g., Lahore, Karachi, Islamabad, Rawalpindi, Faisalabad...)",
    askArea: (city: string) => `Which area in ${city} are you located in?`,
    confirmService: (service: string) => `I hear you need ${service}. Is that correct?`,
    ready: "Perfect! I have all the details. Finding the best service providers for you...",
    error: "Apologies! I'm having trouble connecting. Please try again."
  },
  urdu: {
    askService: "آپ کو کون سی سروس چاہیے؟ (مثلاً پلمبر، اے سی ریپیئر، الیکٹریشن)",
    askCity: "آپ کس شہر میں ہیں؟ (مثلاً لاہور، کراچی، اسلام آباد، راولپنڈی، فیصل آباد...)",
    askArea: (city: string) => `آپ ${city} کے کس علاقے میں ہیں؟`,
    confirmService: (service: string) => `مجھے سمجھ آیا کہ آپ کو ${service} چاہیے۔ کیا یہ درست ہے؟`,
    ready: "بہترین! میرے پاس تمام تفصیلات ہیں۔ آپ کے لیے بہترین سروس فراہم کرنے والے تلاش کر رہا ہوں...",
    error: "معذرت! مجھے رابطہ کرنے میں مسئلہ ہو رہا ہے۔ براہ کرم دوبارہ کوشش کریں۔"
  },
  roman_urdu: {
    askService: "Aap ko konsi service chahiye? (e.g., Plumber, AC Repair, Electrician)",
    askCity: "Aap kis shehar mein hain? (e.g., Lahore, Karachi, Islamabad, Rawalpindi, Faisalabad...)",
    askArea: (city: string) => `Aap ${city} ke kis area mein hain?`,
    confirmService: (service: string) => `Mujhe samajh aaya ke aap ko ${service} chahiye. Kya yeh theek hai?`,
    ready: "Zabardast! Mere paas sari details hain. Aap ke liye best providers dhoond raha hoon...",
    error: "Maazrat! Connection mein masla hai. Please dobara try karein."
  }
};

// =========================
// CITY ALIASES
// =========================
export const cityAliases: Record<string, string[]> = {
  // Punjab
  Lahore:           ['lahore', 'لاہور', 'لہور', 'lhr'],
  Rawalpindi:       ['rawalpindi', 'pindi', 'راولپنڈی', 'پنڈی', 'rwp'],
  Faisalabad:       ['faisalabad', 'fsd', 'lyallpur', 'فیصل آباد', 'فیصلاباد', 'لائل پور'],
  Gujranwala:       ['gujranwala', 'گوجرانوالہ', 'gwl'],
  Multan:           ['multan', 'ملتان', 'mtn'],
  Sialkot:          ['sialkot', 'سیالکوٹ', 'skp'],
  Bahawalpur:       ['bahawalpur', 'بہاولپور', 'bwp'],
  Sargodha:         ['sargodha', 'سرگودھا'],
  Gujrat:           ['gujrat', 'گجرات'],
  Sheikhupura:      ['sheikhupura', 'شیخوپورہ'],
  Rahim_Yar_Khan:   ['rahim yar khan', 'ryk', 'رحیم یار خان'],
  Jhang:            ['jhang', 'جھنگ'],
  Kasur:            ['kasur', 'قصور'],
  Okara:            ['okara', 'اوکاڑہ'],
  Chiniot:          ['chiniot', 'چنیوٹ'],
  Hafizabad:        ['hafizabad', 'حافظ آباد'],
  Mandi_Bahauddin:  ['mandi bahauddin', 'منڈی بہاؤالدین', 'mb'],
  Narowal:          ['narowal', 'نارووال'],
  Vehari:           ['vehari', 'وہاڑی'],
  Sahiwal:          ['sahiwal', 'ساہیوال'],
  Attock:           ['attock', 'اٹک', 'campbellpur'],
  Chakwal:          ['chakwal', 'چکوال'],
  Khushab:          ['khushab', 'خوشاب'],
  Pakpattan:        ['pakpattan', 'پاکپتن'],
  Khanewal:         ['khanewal', 'خانیوال'],
  Layyah:           ['layyah', 'لیہ'],
  Lodhran:          ['lodhran', 'لودھراں'],
  Muzaffargarh:     ['muzaffargarh', 'مظفرگڑھ'],
  Rajanpur:         ['rajanpur', 'راجن پور'],
  Bhakkar:          ['bhakkar', 'بھکر'],
  Mianwali:         ['mianwali', 'میانوالی'],
  Toba_Tek_Singh:   ['toba tek singh', 'tts', 'ٹوبہ ٹیک سنگھ'],
  // Sindh
  Karachi:          ['karachi', 'کراچی', 'کراچي', 'khi'],
  Hyderabad:        ['hyderabad', 'حیدرآباد', 'hyd', 'hyderabad sind'],
  Sukkur:           ['sukkur', 'سکھر'],
  Larkana:          ['larkana', 'لاڑکانہ'],
  Nawabshah:        ['nawabshah', 'نوابشاہ', 'shaheed benazirabad'],
  Mirpurkhas:       ['mirpurkhas', 'میرپور خاص'],
  Jacobabad:        ['jacobabad', 'جیکب آباد'],
  Shikarpur:        ['shikarpur', 'شکارپور'],
  Khairpur:         ['khairpur', 'خیرپور'],
  Dadu:             ['dadu', 'ڈاڈو'],
  Thatta:           ['thatta', 'ٹھٹہ'],
  Badin:            ['badin', 'بدین'],
  // KPK
  Peshawar:         ['peshawar', 'پشاور', 'pew'],
  Mardan:           ['mardan', 'مردان'],
  Mingora:          ['mingora', 'منگورہ', 'swat'],
  Abbottabad:       ['abbottabad', 'ایبٹ آباد', 'abt'],
  Mansehra:         ['mansehra', 'مانسہرہ'],
  Kohat:            ['kohat', 'کوہاٹ'],
  Bannu:            ['bannu', 'بنوں'],
  Dera_Ismail_Khan: ['dera ismail khan', 'dk', 'di khan', 'ڈیرہ اسماعیل خان'],
  Swabi:            ['swabi', 'صوابی'],
  Nowshera:         ['nowshera', 'نوشہرہ'],
  Charsadda:        ['charsadda', 'چارسدہ'],
  Haripur:          ['haripur', 'ہری پور'],
  Karak:            ['karak', 'کرک'],
  Hangu:            ['hangu', 'ہنگو'],
  // Balochistan
  Quetta:           ['quetta', 'کوئٹہ', 'uqt'],
  Turbat:           ['turbat', 'تربت'],
  Khuzdar:          ['khuzdar', 'خضدار'],
  Gwadar:           ['gwadar', 'گوادر'],
  Hub:              ['hub', 'ھب'],
  Chaman:           ['chaman', 'چمن'],
  Zhob:             ['zhob', 'ژوب'],
  Dera_Bugti:       ['dera bugti', 'ڈیرہ بگٹی'],
  // Azad Kashmir & GB
  Muzaffarabad:     ['muzaffarabad', 'مظفرآباد', 'azad kashmir'],
  Gilgit:           ['gilgit', 'گلگت'],
  Skardu:           ['skardu', 'سکردو'],
  Mirpur_AJK:       ['mirpur ajk', 'mirpur', 'میرپور آزاد کشمیر'],
  // ICT
  Islamabad:        ['islamabad', 'اسلام آباد', 'اسلام آبا', 'isb', 'ict'],
};

// =========================
// AREA ALIASES
// =========================
export const areaAliases: Record<string, string[]> = {
  // --- Lahore ---
  'Johar Town':              ['johar town', 'johartown', 'جوہر ٹاؤن', 'jt'],
  'Model Town':              ['model town', 'ماڈل ٹاؤن', 'mt'],
  'DHA Lahore':              ['dha lahore', 'dha', 'ڈی ایچ اے', 'ڈیفنس', 'defence', 'dha phase'],
  'Bahria Town Lahore':      ['bahria town lahore', 'bahria lahore', 'بحریہ ٹاؤن لاہور'],
  'Gulshan-e-Ravi':          ['gulshan-e-ravi', 'gulshan e ravi', 'گلشن راوی', 'gulshan'],
  'Iqbal Town':              ['iqbal town', 'اقبال ٹاؤن'],
  'Faisal Town':             ['faisal town', 'فیصل ٹاؤن'],
  'Wapda Town':              ['wapda town', 'واپڈا ٹاؤن'],
  'Township':                ['township', 'ٹاؤن شپ'],
  'Cantt Lahore':            ['cantt lahore', 'lahore cantt', 'کینٹ لاہور', 'چھاونی'],
  'Allama Iqbal Town':       ['allama iqbal town', 'علامہ اقبال ٹاؤن'],
  'Askari Lahore':           ['askari lahore', 'عسکری لاہور'],
  'Thokar Niaz Baig':        ['thokar niaz baig', 'niaz baig', 'ٹھوکر نیاز بیگ'],
  'Mall Road Lahore':        ['mall road', 'مال روڈ'],
  'Anarkali':                ['anarkali', 'انارکلی'],
  'Saddar Lahore':           ['saddar lahore', 'صدر لاہور'],
  // --- Karachi ---
  'Clifton':                 ['clifton', 'کلفٹن', 'clifton block'],
  'DHA Karachi':             ['dha karachi', 'dha defence karachi', 'ڈی ایچ اے کراچی'],
  'Bahria Town Karachi':     ['bahria town karachi', 'btk', 'بحریہ ٹاؤن کراچی'],
  'PECHS':                   ['pechs', 'پی ای سی ایچ ایس'],
  'Gulshan-e-Iqbal':         ['gulshan-e-iqbal', 'gulshan iqbal', 'گلشن اقبال'],
  'North Nazimabad':         ['north nazimabad', 'نارتھ ناظم آباد'],
  'Nazimabad':               ['nazimabad', 'ناظم آباد'],
  'Korangi':                 ['korangi', 'کورنگی'],
  'Landhi':                  ['landhi', 'لانڈھی'],
  'Malir':                   ['malir', 'ملیر'],
  'Saddar Karachi':          ['saddar karachi', 'صدر کراچی'],
  'Orangi Town':             ['orangi town', 'orangi', 'اورنگی ٹاؤن'],
  'Liaquatabad':             ['liaquatabad', 'لیاقت آباد'],
  'Federal B Area':          ['federal b area', 'fb area', 'ایف بی ایریا'],
  'Surjani Town':            ['surjani town', 'سرجانی ٹاؤن'],
  'Scheme 33':               ['scheme 33', 'اسکیم 33'],
  'Gulistan-e-Jauhar':       ['gulistan-e-jauhar', 'jauhar', 'گلستان جوہر'],
  // --- Islamabad ---
  'F-6':                     ['f-6', 'f6', 'sector f-6', 'ایف چھ'],
  'F-7':                     ['f-7', 'f7', 'sector f-7', 'ایف سات'],
  'F-8':                     ['f-8', 'f8', 'sector f-8'],
  'F-10':                    ['f-10', 'f10', 'sector f-10', 'ایف دس'],
  'F-11':                    ['f-11', 'f11', 'sector f-11', 'ایف گیارہ'],
  'G-9':                     ['g-9', 'g9', 'sector g-9'],
  'G-10':                    ['g-10', 'g10', 'sector g-10'],
  'G-11':                    ['g-11', 'g11', 'sector g-11'],
  'G-13':                    ['g-13', 'g13', 'sector g-13', 'جی تیرہ'],
  'G-14':                    ['g-14', 'g14', 'sector g-14', 'جی چودہ'],
  'E-7':                     ['e-7', 'e7', 'sector e-7', 'ای سات'],
  'I-8':                     ['i-8', 'i8', 'sector i-8', 'آئی آٹھ'],
  'I-10':                    ['i-10', 'i10', 'sector i-10'],
  'Blue Area':               ['blue area', 'بلیو ایریا'],
  'Bahria Town Islamabad':   ['bahria town islamabad', 'bahria islamabad', 'بحریہ ٹاؤن اسلام آباد'],
  'DHA Islamabad':           ['dha islamabad', 'ڈی ایچ اے اسلام آباد'],
  'Bani Gala':               ['bani gala', 'بنی گالہ'],
  'PWD':                     ['pwd', 'پی ڈبلیو ڈی'],
  'Soan Garden':             ['soan garden', 'سوان گارڈن'],
  // --- Rawalpindi ---
  'Saddar Rawalpindi':       ['saddar rawalpindi', 'saddar pindi', 'صدر راولپنڈی'],
  'Cantt Rawalpindi':        ['cantt rawalpindi', 'pindi cantt', 'راولپنڈی کینٹ'],
  'Bahria Town Rawalpindi':  ['bahria town rawalpindi', 'bahria pindi', 'بحریہ ٹاؤن راولپنڈی'],
  'DHA Rawalpindi':          ['dha rawalpindi', 'dha pindi', 'ڈی ایچ اے راولپنڈی'],
  'Satellite Town':          ['satellite town', 'سیٹلائٹ ٹاؤن'],
  'Chakri Road':             ['chakri road', 'چکری روڈ'],
  'Adiala Road':             ['adiala road', 'ادیالہ روڈ'],
  // --- Faisalabad ---
  'Peoples Colony':          ['peoples colony', 'پیپلز کالونی'],
  'Ghulam Muhammad Abad':    ['ghulam muhammad abad', 'gm abad', 'غلام محمد آباد'],
  'Jinnah Colony':           ['jinnah colony', 'جناح کالونی'],
  'Susan Road':              ['susan road', 'سوسن روڈ'],
  'Satiana Road':            ['satiana road', 'ستیانہ روڈ'],
  // --- Multan ---
  'Cantt Multan':            ['cantt multan', 'multan cantt', 'ملتان کینٹ'],
  'Shah Rukn-e-Alam':        ['shah rukn-e-alam', 'shah rukn alam', 'شاہ رکن عالم'],
  'Gulgasht Colony':         ['gulgasht colony', 'گلگشت کالونی'],
  'DHA Multan':              ['dha multan', 'ڈی ایچ اے ملتان'],
  // --- Gujranwala ---
  'Model Town Gujranwala':   ['model town gujranwala', 'ماڈل ٹاؤن گوجرانوالہ'],
  'Peoples Colony Gujranwala': ['peoples colony gujranwala', 'پیپلز کالونی گوجرانوالہ'],
  // --- Peshawar ---
  'Hayatabad':               ['hayatabad', 'حیات آباد'],
  'University Town':         ['university town', 'uni town', 'یونیورسٹی ٹاؤن'],
  'Cantt Peshawar':          ['cantt peshawar', 'peshawar cantt', 'پشاور کینٹ'],
  'Saddar Peshawar':         ['saddar peshawar', 'صدر پشاور'],
  // --- Quetta ---
  'Satellite Town Quetta':   ['satellite town quetta', 'سیٹلائٹ ٹاؤن کوئٹہ'],
  'Cantt Quetta':            ['cantt quetta', 'quetta cantt', 'کوئٹہ کینٹ'],
  'Jinnah Town':             ['jinnah town', 'جناح ٹاؤن'],
  // --- Generic / Multi-city ---
  'Downtown':                ['downtown', 'city center', 'city centre'],
  'Cantt':                   ['cantt', 'cantonment', 'کینٹ', 'چھاونی'],
  'DHA':                     ['dha', 'ڈی ایچ اے', 'defence', 'ڈیفنس'],
  'Bahria Town':             ['bahria town', 'بحریہ ٹاؤن', 'bahria', 'بحریہ'],
  'Askari':                  ['askari', 'عسکری'],
};

// =========================
// SERVICE ALIASES
// =========================
export const serviceAliases: Record<string, string[]> = {
  // ── ORIGINAL ──
  "AC repair": [
    "ac", "a.c", "aircon", "ac repair", "air conditioner", "ac kharab", "cooling", "compressor", "thanda nahi",
    "ac service", "ac installation", "ac gas", "uninstallation", "technician",
    "اے سی", "ایئر کنڈیشنر", "اے سی خراب", "ٹھنڈا نہیں", "کمپریسر",
    "اے سی سروس", "اے سی مرمت", "ائیر کنڈیشنر",
  ],
  plumber: [
    "plumber", "pipe", "leak", "tap", "water", "pani", "nalka", "washroom", "toilet", "tank", "technician",
    "پلمبر", "پائپ", "لیک", "نل", "پانی", "واش روم", "ٹوائلٹ", "ٹینک", "نلکا",
  ],
  electrician: [
    "electrician", "light", "switch", "wiring", "spark", "bijli", "fan", "ups", "solar panel", "technician",
    "الیکٹریشن", "بجلی", "لائٹ", "سوئچ", "وائرنگ", "پنکھا", "یو پی ایس",
  ],
  carpenter: [
    "carpenter", "wood", "furniture", "door", "wardrobe", "cabinet", "almari",
    "کارپینٹر", "لکڑی", "فرنیچر", "دروازہ", "بڑھئی", "الماری",
  ],
  painter: [
    "paint", "wall paint", "rang", "colour", "color",
    "پینٹر", "رنگ", "پینٹ", "دیوار رنگ",
  ],
  tutor: [
    "tutor", "teacher", "home tuition", "math teacher", "tuition", "teacher chahiye",
    "استاد", "ٹیوشن", "ٹیچر", "پڑھانا", "گھر ٹیوشن",
  ],
  beautician: [
    "beautician", "makeup", "facial", "parlor", "waxing", "threading", "mehndi",
    "بیوٹیشن", "میک اپ", "فیشل", "پارلر", "خوبصورتی", "مہندی",
  ],
  "generator mechanic": [
    "generator", "genset", "gen mechanic",
    "جنریٹر", "جنریٹر مستری",
  ],
  // ── HOME SERVICES ──
  maid: [
    "maid", "house maid", "cleaning lady", "helper", "kaam wali", "bai",
    "ماسی", "کام والی", "گھریلو ملازم",
  ],
  cook: [
    "cook", "chef", "cooking", "khana banana", "bawarchi", "kitchen help",
    "باورچی", "کھانا", "پکانا", "شیف", "کھانا بنانا",
  ],
  laundry: [
    "laundry", "ironing", "dry clean", "press clothes", "kapray press",
    "لانڈری", "استری", "کپڑے پریس", "ڈرائی کلین", "کپڑے دھونا",
  ],
  "deep cleaning": [
    "deep cleaning", "sofa cleaning", "carpet cleaning", "mattress cleaning",
    "floor cleaning", "house cleaning", "home cleaning", "ghar ki safai",
    "گھر کی صفائی", "صوفہ صفائی", "قالین صفائی", "فرش صفائی",
  ],
  "water tank cleaning": [
    "water tank cleaning", "tank cleaning", "tanki safai",
    "ٹینکی صفائی", "پانی کی ٹینکی",
  ],
  gardener: [
    "gardener", "garden", "plants", "lawn", "mali", "tree cutting",
    "مالی", "باغبان", "پودے", "گارڈن", "لان",
  ],
  driver: [
    "driver", "personal driver", "chauffeur", "car driver", "driver chahiye",
    "ڈرائیور", "گاڑی چلانا",
  ],
  "security guard": [
    "security guard", "guard", "chowkidar", "watchman",
    "چوکیدار", "سیکیورٹی گارڈ",
  ],
  // ── APPLIANCE REPAIR ──
  "fridge repair": [
    "fridge", "refrigerator", "fridge kharab", "fridge repair",
    "فریج", "ریفریجریٹر", "فریج خراب", "فریج ٹھنڈا نہیں",
  ],
  "washing machine repair": [
    "washing machine", "washer", "washing machine kharab", "drum",
    "واشنگ مشین", "واشر", "واشنگ مشین خراب",
  ],
  "microwave repair": [
    "microwave", "microwave kharab",
    "مائیکرو ویو", "مائیکرو ویو خراب",
  ],
  "oven repair": [
    "oven repair", "oven kharab", "baking oven",
    "اوون خراب", "اوون مرمت",
  ],
  "geyser repair": [
    "geyser", "water heater", "geyser kharab", "hot water",
    "گیزر", "واٹر ہیٹر", "گیزر خراب", "گرم پانی",
  ],
  "water dispenser repair": [
    "water dispenser", "dispenser kharab",
    "واٹر ڈسپینسر", "ڈسپینسر خراب",
  ],
  "TV repair": [
    "tv repair", "television", "lcd repair", "led repair", "screen repair",
    "ٹی وی خراب", "ایل سی ڈی", "ایل ای ڈی", "ٹی وی مرمت",
  ],
  "iron repair": [
    "iron repair", "steam iron repair",
    "استری خراب", "آئرن مرمت",
  ],
  "dishwasher repair": [
    "dishwasher", "dish washer repair",
    "ڈش واشر", "ڈش واشر خراب",
  ],
  // ── VEHICLE SERVICES ──
  "car mechanic": [
    "car mechanic", "car repair", "auto mechanic", "engine repair", "car service",
    "gaari kharab", "car breakdown", "car oil change",
    "گاڑی مستری", "کار مکینک", "کار خراب", "گاڑی خراب", "انجن",
  ],
  "bike mechanic": [
    "bike mechanic", "motorcycle mechanic", "bike repair", "motorbike repair",
    "bike kharab", "motorcycle service",
    "بائیک مستری", "موٹرسائیکل مکینک", "بائیک خراب",
  ],
  "puncture repair": [
    "puncture", "tyre repair", "flat tyre", "tire",
    "پنکچر", "ٹائر", "ٹائر خراب",
  ],
  "car wash": [
    "car wash", "vehicle wash", "auto wash", "car cleaning",
    "کار واش", "گاڑی دھونا",
  ],
  "car towing": [
    "tow", "towing", "breakdown towing", "car tow",
    "ٹوئنگ", "گاڑی اٹھانا",
  ],
  // ── HEALTHCARE ──
  nurse: [
    "nurse", "home nurse", "nursing", "patient care", "drip", "injection",
    "نرس", "ہوم نرس", "مریض کی دیکھ بھال", "انجیکشن", "ڈرپ",
  ],
  physiotherapist: [
    "physiotherapist", "physiotherapy", "physio", "exercise therapy",
    "فزیوتھراپسٹ", "فزیوتھراپی",
  ],
  "doctor home visit": [
    "doctor", "home visit", "doctor visit", "physician", "gp",
    "ڈاکٹر", "ڈاکٹر گھر", "معالج",
  ],
  caretaker: [
    "caretaker", "elderly care", "old age care", "patient attendant",
    "نگہبان", "بزرگ کی دیکھ بھال",
  ],
  "lab test": [
    "lab test", "blood test", "pathology", "home sample", "test at home",
    "لیب ٹیسٹ", "خون کا ٹیسٹ", "گھر پر ٹیسٹ",
  ],
  // ── IT & TECH ──
  "CCTV installation": [
    "cctv", "cctv installation", "camera installation", "security camera",
    "سی سی ٹی وی", "کیمرہ", "سیکیورٹی کیمرہ",
  ],
  "networking & wifi": [
    "networking", "wifi", "router", "internet setup", "lan", "wifi setup",
    "نیٹ ورکنگ", "وائی فائی", "روٹر", "انٹرنیٹ سیٹ اپ",
  ],
  "phone repair": [
    "phone repair", "mobile repair", "screen replacement", "mobile kharab",
    "phone screen", "battery replacement",
    "موبائل مرمت", "فون خراب", "اسکرین ٹوٹی", "بیٹری",
  ],
  "computer repair": [
    "computer repair", "laptop repair", "pc repair", "computer kharab",
    "laptop kharab", "format", "reinstall windows",
    "کمپیوٹر مرمت", "لیپ ٹاپ خراب", "فارمیٹ",
  ],
  "solar installation": [
    "solar panel", "solar installation", "solar system", "solar setup",
    "سولر پینل", "سولر سسٹم",
  ],
  // ── CONSTRUCTION & RENOVATION ──
  mason: [
    "mason", "brick work", "construction", "repair wall", "plaster",
    "راج مستری", "چنائی", "دیوار", "پلستر",
  ],
  tiler: [
    "tiler", "tile work", "tiles", "floor tiles", "bathroom tiles",
    "ٹائل مستری", "ٹائلیں", "فرش ٹائل",
  ],
  welder: [
    "welder", "welding", "gate welding", "grill",
    "ویلڈر", "ویلڈنگ", "گیٹ", "گرل",
  ],
  "false ceiling": [
    "false ceiling", "pop ceiling", "ceiling work", "gypsum",
    "فالس سیلنگ", "پی او پی", "چھت کام",
  ],
  waterproofing: [
    "waterproofing", "roof leakage", "seepage", "water seepage", "damp wall",
    "واٹر پروفنگ", "چھت رسنا", "نمی", "لیکیج",
  ],
  "interior designer": [
    "interior designer", "interior design", "home design", "decor",
    "انٹیریئر ڈیزائنر", "گھر سجانا",
  ],
  // ── PEST CONTROL ──
  "pest control": [
    "pest control", "fumigation", "termite", "cockroach", "rats", "mice",
    "mosquito spray", "bed bugs", "insects",
    "کیڑے مار", "فیومیگیشن", "دیمک", "چوہے", "مچھر", "کیڑے",
  ],
};

// =========================
// FUZZY / PHONETIC HELPERS
// =========================

/**
 * Phonetic normalizer for Pakistani-accented speech-to-text.
 * Collapses vowel/consonant variations so "lahaur", "lehor", "lahor"
 * all reduce to the same phonetic key.
 *
 * Less aggressive than before — only normalizes actual ambiguous sounds
 * rather than collapsing ALL vowels, which caused false positives.
 */
function phoneticNormalize(str: string): string {
  return str
    .toLowerCase()
    // Normalize common Pakistani pronunciation variants
    .replace(/ph/g, 'f')
    .replace(/kh/g, 'k')
    .replace(/gh/g, 'g')
    .replace(/sh/g, 's')
    .replace(/ch/g, 'c')
    .replace(/wh/g, 'w')
    .replace(/ck/g, 'k')
    .replace(/qu/g, 'k')
    // Vowel normalization: collapse only clearly equivalent sounds
    .replace(/ou/g, 'o')           // "lahaur" → "lahor"
    .replace(/oo/g, 'u')           // "moosa" → "musa"
    .replace(/ee/g, 'i')           // "beet" → "bit"
    .replace(/ei/g, 'i')
    .replace(/ae/g, 'a')
    .replace(/ai/g, 'a')
    .replace(/ay/g, 'a')
    .replace(/ey/g, 'e')
    .replace(/ie/g, 'i')
    // Drop silent trailing 'e' only after consonants
    .replace(/([^aeiou])e$/, '$1')
    // Collapse repeated characters
    .replace(/(.)\1+/g, '$1')
    .trim();
}

/** Levenshtein edit distance between two strings */
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
}

/**
 * Returns true if `word` is a close phonetic/fuzzy match to `alias`.
 * Only applies to Latin-script aliases of 4+ characters.
 * Threshold: 1 edit per 4 chars — e.g. alias length 8 → threshold 2.
 */
function fuzzyMatch(word: string, alias: string): boolean {
  if (/[\u0600-\u06FF]/.test(alias) || alias.length < 4) return false;
  const pw = phoneticNormalize(word);
  const pa = phoneticNormalize(alias);
  if (pw === pa) return true;
  const threshold = Math.max(1, Math.floor(alias.length / 4));
  return levenshtein(pw, pa) <= threshold;
}

/**
 * Core fuzzy lookup: finds the best fuzzy match for any word (or phrase window)
 * in the input against all aliases in a given dictionary.
 *
 * Returns { matched: canonicalName, heard: whatUserSaid } or null.
 */
function fuzzyLookup(
  normalizedInput: string,
  dict: Record<string, string[]>
): { matched: string; heard: string } | null {
  const words = normalizedInput.split(/\s+/);
  let bestScore = Infinity;
  let bestMatch: string | null = null;
  let bestHeard: string | null = null;

  for (const [canonicalName, aliases] of Object.entries(dict)) {
    for (const alias of aliases) {
      if (/[\u0600-\u06FF]/.test(alias) || alias.length < 4) continue;

      const aliasWords = alias.split(/\s+/);

      if (aliasWords.length === 1) {
        for (const word of words) {
          if (word.length < 3) continue;
          const score = levenshtein(phoneticNormalize(word), phoneticNormalize(alias));
          const threshold = Math.max(1, Math.floor(alias.length / 4));
          if (score <= threshold && score < bestScore) {
            bestScore = score;
            bestMatch = canonicalName;
            bestHeard = word;
          }
        }
      } else {
        for (let i = 0; i <= words.length - aliasWords.length; i++) {
          const chunk = words.slice(i, i + aliasWords.length).join(' ');
          const score = levenshtein(phoneticNormalize(chunk), phoneticNormalize(alias));
          const threshold = Math.max(1, Math.floor(alias.length / 4));
          if (score <= threshold && score < bestScore) {
            bestScore = score;
            bestMatch = canonicalName;
            bestHeard = chunk;
          }
        }
      }
    }
  }

  return bestMatch ? { matched: bestMatch, heard: bestHeard! } : null;
}

/**
 * Like fuzzyLookup, but returns ALL fuzzy matches above threshold —
 * used for services where a user may request multiple at once.
 * Each word/chunk in the input is tested independently, so
 * "plummer and electrishun" finds both "plumber" and "electrician".
 *
 * A word already claimed by an exact match is skipped to avoid double-counting.
 */
function fuzzyLookupAll(
  normalizedInput: string,
  dict: Record<string, string[]>,
  alreadyMatched: Set<string>
): Array<{ matched: string; heard: string }> {
  const words = normalizedInput.split(/\s+/);
  // Track which input word positions have been consumed so we don't match twice
  const usedPositions = new Set<number>();
  const results: Array<{ matched: string; heard: string }> = [];

  // Build candidate list: (canonicalName, alias, score, startIdx, length)
  type Candidate = { canonical: string; heard: string; score: number; start: number; len: number };
  const candidates: Candidate[] = [];

  for (const [canonicalName, aliases] of Object.entries(dict)) {
    if (alreadyMatched.has(canonicalName)) continue;

    for (const alias of aliases) {
      if (/[\u0600-\u06FF]/.test(alias) || alias.length < 4) continue;

      const aliasWords = alias.split(/\s+/);
      const threshold = Math.max(1, Math.floor(alias.length / 4));

      if (aliasWords.length === 1) {
        for (let wi = 0; wi < words.length; wi++) {
          const word = words[wi];
          if (word.length < 3) continue;
          const score = levenshtein(phoneticNormalize(word), phoneticNormalize(alias));
          if (score <= threshold) {
            candidates.push({ canonical: canonicalName, heard: word, score, start: wi, len: 1 });
          }
        }
      } else {
        for (let i = 0; i <= words.length - aliasWords.length; i++) {
          const chunk = words.slice(i, i + aliasWords.length).join(' ');
          const score = levenshtein(phoneticNormalize(chunk), phoneticNormalize(alias));
          if (score <= threshold) {
            candidates.push({ canonical: canonicalName, heard: chunk, score, start: i, len: aliasWords.length });
          }
        }
      }
    }
  }

  // Sort by score ascending, then greedily pick non-overlapping matches
  candidates.sort((a, b) => a.score - b.score);
  const matchedCanonicals = new Set<string>();

  for (const c of candidates) {
    if (matchedCanonicals.has(c.canonical)) continue;
    // Check no position overlap
    const positions = Array.from({ length: c.len }, (_, i) => c.start + i);
    if (positions.some(p => usedPositions.has(p))) continue;

    matchedCanonicals.add(c.canonical);
    positions.forEach(p => usedPositions.add(p));
    results.push({ matched: c.canonical, heard: c.heard });
  }

  return results;
}

// =========================
// EXACT MATCH HELPER
// =========================
function inputIncludes(alias: string, normalizedInput: string, originalInput: string): boolean {
  if (/[\u0600-\u06FF]/.test(alias)) return originalInput.includes(alias);
  const lowerAlias = alias.toLowerCase();
  
  // For short aliases or common technical terms, use strict word boundaries
  if (lowerAlias.length <= 3 || lowerAlias === 'maid' || lowerAlias === 'cook') {
    const esc = lowerAlias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${esc}\\b`, 'i');
    return regex.test(normalizedInput);
  }
  
  return normalizedInput.includes(lowerAlias);
}

// =========================
// MAIN: extractIntent
// =========================
export function extractIntent(input: string) {
  const normalizedInput = input.toLowerCase();
  const originalInput = input;
  const isUrduScript = /[\u0600-\u06FF]/.test(input);

  let serviceTypes: string[] = [];
  let city: string | null = null;
  let area: string | null = null;

  const check = (alias: string) => inputIncludes(alias, normalizedInput, originalInput);

  // Fuzzy metadata — all three categories now tracked in parallel
  let cityFuzzyMatched = false;
  let cityHeard: string | null = null;

  let areaFuzzyMatched = false;
  let areaHeard: string | null = null;

  // For services we may have multiple fuzzy corrections
  let serviceFuzzyMatched = false;
  const serviceFuzzyHints: Array<{ heard: string; corrected: string }> = [];

  // ─────────────────────────────────────────
  // CITY — Step 1: Exact match
  // ─────────────────────────────────────────
  for (const [cityName, aliases] of Object.entries(cityAliases)) {
    for (const alias of aliases) {
      if (check(alias)) {
        city = cityName.replace(/_/g, ' ');
        break;
      }
    }
    if (city) break;
  }

  // CITY — Step 2: Fuzzy/phonetic match
  if (!city && !isUrduScript) {
    const cityDictFlat: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(cityAliases)) {
      cityDictFlat[k.replace(/_/g, ' ')] = v;
    }
    const result = fuzzyLookup(normalizedInput, cityDictFlat);
    if (result) {
      city = result.matched;
      cityFuzzyMatched = true;
      cityHeard = result.heard;
    }
  }

  // ─────────────────────────────────────────
  // AREA — Step 1: Exact match
  // ─────────────────────────────────────────
  for (const [areaName, aliases] of Object.entries(areaAliases)) {
    for (const alias of aliases) {
      if (check(alias)) {
        area = areaName;
        break;
      }
    }
    if (area) break;
  }

  // AREA — Step 2: Fuzzy/phonetic match (now enabled for all Latin-script inputs,
  // not just when exact match failed — exact already short-circuits above)
  if (!area && !isUrduScript) {
    const result = fuzzyLookup(normalizedInput, areaAliases);
    if (result) {
      area = result.matched;
      areaFuzzyMatched = true;
      areaHeard = result.heard;
    }
  }

  // AREA — Step 3: Fallback text extraction (if city known but area still missing)
  if (!area && city) {
    const urduFillerWords = ['میں', 'کے', 'کی', 'کا', 'سے', 'پر', 'کو', 'ہے', 'ہیں', 'چاہیے', 'مجھے', 'ہمیں', 'فوری', 'ابھی', 'براہ', 'کرم'];
    if (isUrduScript) {
      const cityKey = Object.keys(cityAliases).find(k => k.replace(/_/g, ' ') === city);
      const cityUrduAliases = cityKey ? cityAliases[cityKey] : [];
      let fallback = originalInput;
      for (const alias of cityUrduAliases) fallback = fallback.replace(alias, '');
      fallback = fallback
        .replace(/پلمبر|الیکٹریشن|اے سی|کارپینٹر|پینٹر|استاد|ٹیوشن|بیوٹیشن|نل|بجلی|لیک|پائپ|ٹھنڈا|مستری|فریج|واشنگ مشین|مکینک|نرس|ڈاکٹر|سی سی ٹی وی|کیڑے|صفائی|ماسی|باورچی|لانڈری|ٹائل|ویلڈر|راج مستری|موبائل|کمپیوٹر|سولر|جنریٹر/g, '')
        .replace(new RegExp(urduFillerWords.join('|'), 'g'), '')
        .replace(/[^\u0600-\u06FFa-zA-Z0-9\s-]/g, '')
        .trim();
      if (fallback.length > 1) area = fallback;
    } else {
      // Build a dynamic regex from all service aliases to strip them from the area fallback
      const allServiceAliases = Object.values(serviceAliases).flat();
      const serviceRegex = new RegExp(allServiceAliases.map(v => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi');
      
      let fallback = normalizedInput
        .replace(city.toLowerCase(), '')
        .replace(serviceRegex, '')
        .replace(/main|mein|near|chahiye|chahye|urgent|asap|in|at|the|a|an|pkr|rs|price/g, '')
        .replace(/[^a-z0-9\s\u0600-\u06FF-]/g, '')
        .trim();
      if (fallback.length > 2 && !/^\d+$/.test(fallback)) area = fallback;
    }
  }

  // AREA — Step 4: Input might just be the area name after city
  if (!area && city) {
    const cityKey = Object.keys(cityAliases).find(k => k.replace(/_/g, ' ') === city) || city;
    const cityLower = city.toLowerCase();
    let inputWithoutCity = isUrduScript
      ? originalInput.replace(new RegExp((cityAliases[cityKey] || []).join('|'), 'g'), '').trim()
      : normalizedInput.replace(cityLower, '').trim();
    if (inputWithoutCity.length > 0 && inputWithoutCity.length <= 50) {
      const cleaned = isUrduScript
        ? inputWithoutCity.replace(/میں|کے|کی|کا|سے|پر|چاہیے|ہے/g, '').trim()
        : inputWithoutCity
            .replace(/main|mein|near|in|at|the|a|an|chahiye|chahye|sector|block|phase|road/g, '')
            .replace(/[^a-z0-9\s\u0600-\u06FF-]/g, '')
            .trim();
      if (cleaned.length > 1) area = cleaned;
    }
  }

  // AREA — Step 5: Capitalize for Latin script
  if (area && !isPlaceholder(area) && !isUrduScript) {
    if (!/^[A-Z0-9-]+$/.test(area))
      area = area.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  // ─────────────────────────────────────────
  // SERVICE — Step 1: Exact match (find ALL)
  // ─────────────────────────────────────────
  for (const [service, aliases] of Object.entries(serviceAliases)) {
    for (const alias of aliases) {
      if (check(alias)) {
        if (!serviceTypes.includes(service)) serviceTypes.push(service);
      }
    }
  }

  // SERVICE — Step 2: Fuzzy match for ALL remaining services not yet found.
  // Uses fuzzyLookupAll so "plummer and ac repare" → both plumber + AC repair.
  if (!isUrduScript) {
    const alreadyExact = new Set(serviceTypes);
    const romanUrduFiller = new Set(['mera', 'mujy', 'mujh', 'mujhe', 'chahiye', 'chahye', 'nahi', 'nahin', 'raha', 'rahi', 'rahe', 'karna', 'karne', 'haye', 'hai', 'hain']);
    
    // Pre-filter words to avoid matching fillers to services
    const filteredInputLines = normalizedInput.split(/\s+/).filter(w => !romanUrduFiller.has(w)).join(' ');

    const fuzzyResults = fuzzyLookupAll(filteredInputLines, serviceAliases, alreadyExact);
    for (const { matched, heard } of fuzzyResults) {
      if (!serviceTypes.includes(matched)) {
        serviceTypes.push(matched);
        serviceFuzzyMatched = true;
        serviceFuzzyHints.push({ heard, corrected: matched });
      }
    }
  }

  // ─────────────────────────────────────────
  // LANGUAGE DETECTION
  // ─────────────────────────────────────────
  let detectedLanguage = 'english';
  if (isUrduScript) {
    detectedLanguage = 'urdu';
  } else if (/\b(chahiye|chahye|karna|karne|karo|masla|sasta|pani|bijli|teacher|shehar|mein|hain|hai|ka|ki|ke|pay|par|raha|rahi|rahe|ji|han|haan|na|nahi|shukriya|shukria|theek|thik|zaroorat|zarurat|bhai|janab|beta|uncle|aunty|app|khidmat|madad|help|problem|kharab|behtar|acha|achi|kab|kahan|kyun|kon|kese|kaise)\b/i.test(input)) {
    detectedLanguage = 'roman_urdu';
  }

  // ─────────────────────────────────────────
  // FALLBACK PLACEHOLDERS
  // ─────────────────────────────────────────
  const fallbacks = {
    service: detectedLanguage === 'urdu' ? '[سروس درج کریں]' : '[Specify Service]',
    city:    detectedLanguage === 'urdu' ? '[شہر درج کریں]'  : '[Specify City]',
    area:    detectedLanguage === 'urdu' ? '[علاقہ درج کریں]': '[Specify Area]',
  };

  return {
    // Core fields (unchanged contract)
    serviceType:  serviceTypes.length > 0 ? serviceTypes[0] : fallbacks.service,
    serviceTypes: serviceTypes.length > 0 ? serviceTypes    : [fallbacks.service],
    city:         city  || fallbacks.city,
    area:         area  || fallbacks.area,
    detectedLanguage,
    isComplete:   !!(serviceTypes.length > 0 && !isPlaceholder(serviceTypes[0]) && city && !isPlaceholder(city) && area && !isPlaceholder(area)),

    // Fuzzy match metadata — use in UI to show "Did you mean X?" corrections

    cityFuzzyMatched,
    cityHeard,            // e.g. "lahaur" → city becomes "Lahore"

    areaFuzzyMatched,
    areaHeard,            // e.g. "johar tawn" → area becomes "Johar Town"

    // Per-service fuzzy corrections (one entry per fuzzy-corrected service)
    serviceFuzzyMatched,
    serviceFuzzyHints,    // e.g. [{ heard: "plummer", corrected: "plumber" }, { heard: "electrishun", corrected: "electrician" }]

    // Legacy single-value kept for backwards compatibility
    serviceHeard: serviceFuzzyHints[0]?.heard ?? null,
  };
}