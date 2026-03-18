/** Layer 2 SVG template system.
 *  Each template is a pre-drawn scientific diagram with named anchor points.
 *  The AI selects a templateId and provides label text for each anchor it wants to show.
 */

export interface TemplateAnchor {
  /** Pointer tip — on or very near the structure being labelled */
  px: number; py: number
  /** Label text position — in the margin outside the main drawing */
  lx: number; ly: number
  /** SVG text-anchor for the label text */
  textAnchor?: 'start' | 'middle' | 'end'
}

export interface SvgTemplate {
  id: string
  description: string
  subject: 'biology' | 'chemistry' | 'physics'
  viewBox: string
  /** Named anchor points — AI references these by key name */
  anchors: Record<string, TemplateAnchor>
  /** Inner SVG elements with no outer <svg> tag */
  svgContent: string
}

export const SVG_TEMPLATES: Record<string, SvgTemplate> = {

  // ── Biology ─────────────────────────────────────────────────────────────

  'bio/animal_cell': {
    id: 'bio/animal_cell',
    description: 'Animal cell cross-section: cell membrane, nucleus (with nucleolus and nuclear membrane), mitochondria, Golgi apparatus, rough endoplasmic reticulum, ribosomes, lysosome, vacuole, cytoplasm',
    subject: 'biology',
    viewBox: '0 0 560 420',
    anchors: {
      cell_membrane:    { px: 432, py: 162, lx: 510, ly: 58,  textAnchor: 'start' },
      nucleus:          { px: 252, py: 205, lx: 50,  ly: 288, textAnchor: 'end'   },
      nuclear_membrane: { px: 323, py: 205, lx: 510, ly: 198, textAnchor: 'start' },
      nucleolus:        { px: 252, py: 205, lx: 50,  ly: 348, textAnchor: 'end'   },
      mitochondrion:    { px: 385, py: 128, lx: 510, ly: 118, textAnchor: 'start' },
      golgi_apparatus:  { px: 390, py: 249, lx: 510, ly: 262, textAnchor: 'start' },
      rough_er:         { px: 196, py: 175, lx: 50,  ly: 175, textAnchor: 'end'   },
      ribosome:         { px: 252, py: 108, lx: 50,  ly: 102, textAnchor: 'end'   },
      lysosome:         { px: 340, py: 170, lx: 510, ly: 188, textAnchor: 'start' },
      vacuole:          { px: 362, py: 298, lx: 510, ly: 318, textAnchor: 'start' },
      cytoplasm:        { px: 195, py: 318, lx: 50,  ly: 390, textAnchor: 'end'   },
    },
    svgContent: `
      <ellipse cx="270" cy="208" rx="172" ry="145" fill="#FFFDE7" stroke="#F59E0B" stroke-width="2.5"/>
      <ellipse cx="252" cy="205" rx="71" ry="60" fill="#EFF6FF" stroke="#3B82F6" stroke-width="2.2"/>
      <ellipse cx="252" cy="205" rx="64" ry="53" fill="#DBEAFE" stroke="#2563EB" stroke-width="1" stroke-dasharray="4,2"/>
      <circle cx="190" cy="205" r="3.5" fill="white" stroke="#3B82F6" stroke-width="1.5"/>
      <circle cx="314" cy="205" r="3.5" fill="white" stroke="#3B82F6" stroke-width="1.5"/>
      <circle cx="222" cy="152" r="3.5" fill="white" stroke="#3B82F6" stroke-width="1.5"/>
      <circle cx="282" cy="152" r="3.5" fill="white" stroke="#3B82F6" stroke-width="1.5"/>
      <ellipse cx="252" cy="205" rx="25" ry="21" fill="#BFDBFE" stroke="#1D4ED8" stroke-width="1.5"/>
      <ellipse cx="385" cy="128" rx="38" ry="22" fill="#FEE2E2" stroke="#EF4444" stroke-width="1.8"/>
      <path d="M367,121 Q380,113 393,121 Q406,129 393,137 Q380,145 367,137 Z" fill="none" stroke="#EF4444" stroke-width="1" opacity="0.5"/>
      <ellipse cx="160" cy="295" rx="33" ry="20" fill="#FEE2E2" stroke="#EF4444" stroke-width="1.8"/>
      <path d="M144,288 Q157,280 170,288 Q183,296 170,304 Q157,312 144,304 Z" fill="none" stroke="#EF4444" stroke-width="1" opacity="0.5"/>
      <path d="M345,235 Q380,224 412,235" fill="none" stroke="#8B5CF6" stroke-width="6" stroke-linecap="round"/>
      <path d="M341,249 Q378,238 415,249" fill="none" stroke="#8B5CF6" stroke-width="6" stroke-linecap="round"/>
      <path d="M338,263 Q376,252 417,263" fill="none" stroke="#8B5CF6" stroke-width="6" stroke-linecap="round"/>
      <circle cx="337" cy="249" r="7" fill="#EDE9FE" stroke="#8B5CF6" stroke-width="1.2"/>
      <circle cx="418" cy="249" r="6" fill="#EDE9FE" stroke="#8B5CF6" stroke-width="1.2"/>
      <path d="M148,168 Q164,158 180,168 Q196,178 212,168 Q228,158 244,168" fill="none" stroke="#10B981" stroke-width="2"/>
      <path d="M148,183 Q164,173 180,183 Q196,193 212,183 Q228,173 244,183" fill="none" stroke="#10B981" stroke-width="2"/>
      <circle cx="148" cy="168" r="3.5" fill="#065F46"/>
      <circle cx="180" cy="168" r="3.5" fill="#065F46"/>
      <circle cx="212" cy="168" r="3.5" fill="#065F46"/>
      <circle cx="244" cy="168" r="3.5" fill="#065F46"/>
      <circle cx="148" cy="183" r="3.5" fill="#065F46"/>
      <circle cx="180" cy="183" r="3.5" fill="#065F46"/>
      <circle cx="252" cy="108" r="3.5" fill="#065F46"/>
      <circle cx="268" cy="118" r="3.5" fill="#065F46"/>
      <circle cx="338" cy="185" r="3.5" fill="#065F46"/>
      <circle cx="340" cy="170" r="14" fill="#FEF3C7" stroke="#D97706" stroke-width="1.5"/>
      <circle cx="337" cy="167" r="2.5" fill="#D97706"/>
      <circle cx="343" cy="173" r="2.5" fill="#D97706"/>
      <ellipse cx="362" cy="298" rx="28" ry="22" fill="#E0F2FE" stroke="#0EA5E9" stroke-width="1.5"/>
    `,
  },

  'bio/plant_cell': {
    id: 'bio/plant_cell',
    description: 'Plant cell cross-section: cell wall, cell membrane, nucleus (with nucleolus), chloroplasts, large central vacuole, tonoplast, mitochondrion, Golgi apparatus, cytoplasm. Note: plant cells have cell wall + chloroplasts + large vacuole; no centrioles or lysosomes.',
    subject: 'biology',
    viewBox: '0 0 560 450',
    anchors: {
      cell_wall:        { px: 418, py: 70,  lx: 510, ly: 50,  textAnchor: 'start' },
      cell_membrane:    { px: 413, py: 84,  lx: 510, ly: 98,  textAnchor: 'start' },
      nucleus:          { px: 192, py: 115, lx: 50,  ly: 100, textAnchor: 'end'   },
      nucleolus:        { px: 192, py: 115, lx: 50,  ly: 148, textAnchor: 'end'   },
      chloroplast:      { px: 143, py: 205, lx: 50,  ly: 200, textAnchor: 'end'   },
      central_vacuole:  { px: 285, py: 233, lx: 510, ly: 240, textAnchor: 'start' },
      tonoplast:        { px: 175, py: 233, lx: 50,  ly: 285, textAnchor: 'end'   },
      mitochondrion:    { px: 400, py: 348, lx: 510, ly: 355, textAnchor: 'start' },
      golgi_apparatus:  { px: 362, py: 108, lx: 510, ly: 108, textAnchor: 'start' },
      cytoplasm:        { px: 413, py: 325, lx: 510, ly: 395, textAnchor: 'start' },
    },
    svgContent: `
      <rect x="100" y="65" width="340" height="320" rx="4" fill="#F5F5F0" stroke="#78716C" stroke-width="5"/>
      <rect x="108" y="73" width="324" height="304" rx="2" fill="#ECFDF5" stroke="#16A34A" stroke-width="1.5"/>
      <rect x="175" y="148" width="220" height="172" rx="4" fill="#E0F2FE" stroke="#0EA5E9" stroke-width="2"/>
      <ellipse cx="192" cy="115" rx="50" ry="37" fill="#EFF6FF" stroke="#3B82F6" stroke-width="2"/>
      <ellipse cx="192" cy="115" rx="43" ry="30" fill="#DBEAFE" stroke="#2563EB" stroke-width="1" stroke-dasharray="3,2"/>
      <ellipse cx="192" cy="115" rx="17" ry="13" fill="#BFDBFE" stroke="#1D4ED8" stroke-width="1.5"/>
      <ellipse cx="143" cy="205" rx="30" ry="17" fill="#BBF7D0" stroke="#15803D" stroke-width="1.5"/>
      <line x1="125" y1="205" x2="161" y2="205" stroke="#15803D" stroke-width="1"/>
      <line x1="128" y1="198" x2="158" y2="198" stroke="#15803D" stroke-width="0.8"/>
      <line x1="128" y1="212" x2="158" y2="212" stroke="#15803D" stroke-width="0.8"/>
      <ellipse cx="143" cy="275" rx="30" ry="17" fill="#BBF7D0" stroke="#15803D" stroke-width="1.5"/>
      <line x1="125" y1="275" x2="161" y2="275" stroke="#15803D" stroke-width="1"/>
      <line x1="128" y1="268" x2="158" y2="268" stroke="#15803D" stroke-width="0.8"/>
      <line x1="128" y1="282" x2="158" y2="282" stroke="#15803D" stroke-width="0.8"/>
      <ellipse cx="290" cy="92" rx="28" ry="16" fill="#BBF7D0" stroke="#15803D" stroke-width="1.5"/>
      <line x1="274" y1="92" x2="306" y2="92" stroke="#15803D" stroke-width="1"/>
      <line x1="277" y1="85" x2="303" y2="85" stroke="#15803D" stroke-width="0.8"/>
      <ellipse cx="290" cy="355" rx="28" ry="16" fill="#BBF7D0" stroke="#15803D" stroke-width="1.5"/>
      <line x1="274" y1="355" x2="306" y2="355" stroke="#15803D" stroke-width="1"/>
      <ellipse cx="400" cy="348" rx="26" ry="16" fill="#FEE2E2" stroke="#EF4444" stroke-width="1.5"/>
      <path d="M384,341 Q397,333 410,341 Q423,349 410,357 Q397,365 384,357 Z" fill="none" stroke="#EF4444" stroke-width="0.8" opacity="0.5"/>
      <path d="M335,98 Q360,89 388,98" fill="none" stroke="#8B5CF6" stroke-width="5" stroke-linecap="round"/>
      <path d="M332,110 Q360,101 391,110" fill="none" stroke="#8B5CF6" stroke-width="5" stroke-linecap="round"/>
      <path d="M330,122 Q359,113 392,122" fill="none" stroke="#8B5CF6" stroke-width="5" stroke-linecap="round"/>
      <circle cx="329" cy="110" r="5" fill="#EDE9FE" stroke="#8B5CF6" stroke-width="1"/>
      <circle cx="393" cy="110" r="5" fill="#EDE9FE" stroke="#8B5CF6" stroke-width="1"/>
    `,
  },

  'bio/leaf_cross_section': {
    id: 'bio/leaf_cross_section',
    description: 'Leaf transverse section showing layers: upper cuticle, upper epidermis, palisade mesophyll (with chloroplasts), spongy mesophyll (with air spaces), lower epidermis, guard cells, stoma, and vascular bundle (xylem + phloem)',
    subject: 'biology',
    viewBox: '0 0 560 400',
    anchors: {
      upper_epidermis:    { px: 280, py: 70,  lx: 510, ly: 48,  textAnchor: 'start' },
      cuticle:            { px: 280, py: 57,  lx: 510, ly: 28,  textAnchor: 'start' },
      palisade_mesophyll: { px: 280, py: 145, lx: 510, ly: 128, textAnchor: 'start' },
      chloroplast:        { px: 104, py: 130, lx: 50,  ly: 120, textAnchor: 'end'   },
      spongy_mesophyll:   { px: 108, py: 242, lx: 50,  ly: 248, textAnchor: 'end'   },
      air_space:          { px: 245, py: 215, lx: 50,  ly: 310, textAnchor: 'end'   },
      lower_epidermis:    { px: 280, py: 318, lx: 510, ly: 298, textAnchor: 'start' },
      guard_cell:         { px: 355, py: 319, lx: 510, ly: 355, textAnchor: 'start' },
      stoma:              { px: 368, py: 320, lx: 510, ly: 378, textAnchor: 'start' },
      xylem:              { px: 272, py: 250, lx: 50,  ly: 265, textAnchor: 'end'   },
      phloem:             { px: 289, py: 262, lx: 50,  ly: 340, textAnchor: 'end'   },
      vascular_bundle:    { px: 280, py: 255, lx: 50,  ly: 380, textAnchor: 'end'   },
    },
    svgContent: `
      <path d="M60,57 Q140,53 220,57 Q300,61 380,57 Q460,53 500,57" fill="none" stroke="#92400E" stroke-width="2"/>
      <rect x="60" y="57" width="440" height="27" fill="#ECFDF5" stroke="none"/>
      <line x1="60" y1="57" x2="500" y2="57" stroke="#065F46" stroke-width="2"/>
      <line x1="60" y1="84" x2="500" y2="84" stroke="#065F46" stroke-width="2"/>
      <line x1="148" y1="57" x2="148" y2="84" stroke="#065F46" stroke-width="0.8"/>
      <line x1="236" y1="57" x2="236" y2="84" stroke="#065F46" stroke-width="0.8"/>
      <line x1="324" y1="57" x2="324" y2="84" stroke="#065F46" stroke-width="0.8"/>
      <line x1="412" y1="57" x2="412" y2="84" stroke="#065F46" stroke-width="0.8"/>
      <rect x="60" y="84" width="88" height="123" fill="#BBFFD0" stroke="#15803D" stroke-width="1.5"/>
      <rect x="148" y="84" width="88" height="123" fill="#BBFFD0" stroke="#15803D" stroke-width="1.5"/>
      <rect x="236" y="84" width="88" height="123" fill="#BBFFD0" stroke="#15803D" stroke-width="1.5"/>
      <rect x="324" y="84" width="88" height="123" fill="#BBFFD0" stroke="#15803D" stroke-width="1.5"/>
      <rect x="412" y="84" width="88" height="123" fill="#BBFFD0" stroke="#15803D" stroke-width="1.5"/>
      <ellipse cx="104" cy="105" rx="9" ry="6" fill="#15803D"/>
      <ellipse cx="104" cy="128" rx="9" ry="6" fill="#15803D"/>
      <ellipse cx="104" cy="151" rx="9" ry="6" fill="#15803D"/>
      <ellipse cx="104" cy="174" rx="9" ry="6" fill="#15803D"/>
      <ellipse cx="192" cy="105" rx="9" ry="6" fill="#15803D"/>
      <ellipse cx="192" cy="128" rx="9" ry="6" fill="#15803D"/>
      <ellipse cx="192" cy="151" rx="9" ry="6" fill="#15803D"/>
      <ellipse cx="280" cy="108" rx="9" ry="6" fill="#15803D"/>
      <ellipse cx="280" cy="133" rx="9" ry="6" fill="#15803D"/>
      <ellipse cx="280" cy="158" rx="9" ry="6" fill="#15803D"/>
      <ellipse cx="368" cy="108" rx="9" ry="6" fill="#15803D"/>
      <ellipse cx="368" cy="133" rx="9" ry="6" fill="#15803D"/>
      <ellipse cx="456" cy="108" rx="9" ry="6" fill="#15803D"/>
      <ellipse cx="456" cy="133" rx="9" ry="6" fill="#15803D"/>
      <line x1="60" y1="207" x2="500" y2="207" stroke="#15803D" stroke-width="2"/>
      <rect x="60" y="207" width="440" height="100" fill="white" stroke="none"/>
      <ellipse cx="110" cy="242" rx="42" ry="30" fill="#D1FAE5" stroke="#22C55E" stroke-width="1.5"/>
      <ellipse cx="202" cy="225" rx="40" ry="27" fill="#D1FAE5" stroke="#22C55E" stroke-width="1.5"/>
      <ellipse cx="295" cy="257" rx="42" ry="30" fill="#D1FAE5" stroke="#22C55E" stroke-width="1.5"/>
      <ellipse cx="390" cy="232" rx="40" ry="27" fill="#D1FAE5" stroke="#22C55E" stroke-width="1.5"/>
      <ellipse cx="465" cy="250" rx="35" ry="28" fill="#D1FAE5" stroke="#22C55E" stroke-width="1.5"/>
      <ellipse cx="158" cy="272" rx="38" ry="25" fill="#D1FAE5" stroke="#22C55E" stroke-width="1.5"/>
      <ellipse cx="348" cy="278" rx="40" ry="25" fill="#D1FAE5" stroke="#22C55E" stroke-width="1.5"/>
      <ellipse cx="458" cy="290" rx="36" ry="20" fill="#D1FAE5" stroke="#22C55E" stroke-width="1.5"/>
      <ellipse cx="280" cy="255" rx="35" ry="26" fill="#FEF9C3" stroke="#CA8A04" stroke-width="2"/>
      <ellipse cx="272" cy="249" rx="16" ry="12" fill="#BFDBFE" stroke="#2563EB" stroke-width="1.5"/>
      <ellipse cx="289" cy="263" rx="13" ry="10" fill="#FED7AA" stroke="#EA580C" stroke-width="1.3"/>
      <line x1="60" y1="307" x2="500" y2="307" stroke="#15803D" stroke-width="2"/>
      <rect x="60" y="307" width="440" height="25" fill="#ECFDF5" stroke="none"/>
      <line x1="60" y1="332" x2="500" y2="332" stroke="#065F46" stroke-width="2"/>
      <line x1="148" y1="307" x2="148" y2="332" stroke="#065F46" stroke-width="0.8"/>
      <line x1="236" y1="307" x2="236" y2="332" stroke="#065F46" stroke-width="0.8"/>
      <line x1="324" y1="307" x2="324" y2="332" stroke="#065F46" stroke-width="0.8"/>
      <line x1="412" y1="307" x2="412" y2="332" stroke="#065F46" stroke-width="0.8"/>
      <ellipse cx="355" cy="319" rx="13" ry="9" fill="#86EFAC" stroke="#16A34A" stroke-width="1.5"/>
      <ellipse cx="381" cy="319" rx="13" ry="9" fill="#86EFAC" stroke="#16A34A" stroke-width="1.5"/>
      <ellipse cx="368" cy="319" rx="6" ry="4" fill="white"/>
      <path d="M60,332 Q140,336 220,332 Q300,328 380,332 Q460,336 500,332" fill="none" stroke="#92400E" stroke-width="2"/>
    `,
  },

  // ── Chemistry ────────────────────────────────────────────────────────────

  'chem/electrolysis': {
    id: 'chem/electrolysis',
    description: 'Electrolysis apparatus: beaker with electrolyte solution, carbon/graphite cathode (negative, left) and anode (positive, right), connecting wires, DC power supply/battery. Cathode: reduction/metal deposit or H2 gas. Anode: oxidation or Cl2/O2 gas.',
    subject: 'chemistry',
    viewBox: '0 0 560 420',
    anchors: {
      beaker:             { px: 280, py: 345, lx: 280, ly: 395, textAnchor: 'middle' },
      electrolyte:        { px: 280, py: 268, lx: 50,  ly: 272, textAnchor: 'end'   },
      cathode:            { px: 205, py: 175, lx: 50,  ly: 110, textAnchor: 'end'   },
      anode:              { px: 355, py: 175, lx: 510, ly: 110, textAnchor: 'start' },
      negative_electrode: { px: 205, py: 188, lx: 50,  ly: 140, textAnchor: 'end'   },
      positive_electrode: { px: 355, py: 188, lx: 510, ly: 140, textAnchor: 'start' },
      power_supply:       { px: 280, py: 68,  lx: 280, ly: 32,  textAnchor: 'middle' },
      gas_at_cathode:     { px: 190, py: 215, lx: 50,  ly: 205, textAnchor: 'end'   },
      gas_at_anode:       { px: 370, py: 215, lx: 510, ly: 205, textAnchor: 'start' },
    },
    svgContent: `
      <path d="M120,120 L120,345 L440,345 L440,120" fill="none" stroke="#374151" stroke-width="2.5"/>
      <rect x="122" y="235" width="316" height="108" fill="#DBEAFE" opacity="0.5"/>
      <line x1="122" y1="235" x2="438" y2="235" stroke="#2563EB" stroke-width="1.5" stroke-dasharray="5,3"/>
      <rect x="194" y="125" width="22" height="215" fill="#6B7280" stroke="#374151" stroke-width="1.5" rx="2"/>
      <rect x="344" y="125" width="22" height="215" fill="#374151" stroke="#374151" stroke-width="1.5" rx="2"/>
      <circle cx="184" cy="225" r="6" fill="white" stroke="#2563EB" stroke-width="1.5"/>
      <circle cx="192" cy="207" r="5" fill="white" stroke="#2563EB" stroke-width="1.5"/>
      <circle cx="182" cy="190" r="4" fill="white" stroke="#2563EB" stroke-width="1.5"/>
      <circle cx="190" cy="175" r="5" fill="white" stroke="#2563EB" stroke-width="1.5"/>
      <circle cx="186" cy="158" r="4" fill="white" stroke="#2563EB" stroke-width="1.2"/>
      <circle cx="370" cy="227" r="6" fill="white" stroke="#DC2626" stroke-width="1.5"/>
      <circle cx="378" cy="208" r="5" fill="white" stroke="#DC2626" stroke-width="1.5"/>
      <circle cx="368" cy="190" r="4" fill="white" stroke="#DC2626" stroke-width="1.5"/>
      <circle cx="376" cy="173" r="5" fill="white" stroke="#DC2626" stroke-width="1.5"/>
      <circle cx="371" cy="156" r="4" fill="white" stroke="#DC2626" stroke-width="1.2"/>
      <path d="M205,125 L205,75 L265,75" fill="none" stroke="#374151" stroke-width="2.5"/>
      <path d="M355,125 L355,75 L325,75" fill="none" stroke="#374151" stroke-width="2.5"/>
      <rect x="265" y="52" width="60" height="46" rx="4" fill="#F9FAFB" stroke="#374151" stroke-width="2"/>
      <line x1="275" y1="65" x2="275" y2="83" stroke="#374151" stroke-width="4"/>
      <line x1="283" y1="69" x2="283" y2="79" stroke="#374151" stroke-width="1.5"/>
      <line x1="297" y1="65" x2="297" y2="83" stroke="#374151" stroke-width="1.5"/>
      <line x1="305" y1="69" x2="305" y2="79" stroke="#374151" stroke-width="4"/>
      <line x1="319" y1="65" x2="319" y2="83" stroke="#374151" stroke-width="1.5"/>
      <line x1="205" y1="75" x2="205" y2="68" stroke="#374151" stroke-width="1.5"/>
      <line x1="355" y1="75" x2="355" y2="68" stroke="#374151" stroke-width="1.5"/>
    `,
  },

  'chem/simple_distillation': {
    id: 'chem/simple_distillation',
    description: 'Simple distillation apparatus: round-bottomed flask with liquid, thermometer in neck, side-arm delivery tube, Liebig condenser (with water in/out), collecting conical flask, heat source. Used to separate liquids with different boiling points.',
    subject: 'chemistry',
    viewBox: '0 0 560 420',
    anchors: {
      flask:            { px: 155, py: 248, lx: 50,  ly: 265, textAnchor: 'end'   },
      liquid:           { px: 155, py: 278, lx: 50,  ly: 320, textAnchor: 'end'   },
      thermometer:      { px: 178, py: 128, lx: 50,  ly: 62,  textAnchor: 'end'   },
      condenser:        { px: 340, py: 220, lx: 280, ly: 155, textAnchor: 'middle' },
      water_in:         { px: 418, py: 285, lx: 510, ly: 320, textAnchor: 'start' },
      water_out:        { px: 258, py: 195, lx: 510, ly: 155, textAnchor: 'start' },
      collecting_flask: { px: 468, py: 310, lx: 510, ly: 290, textAnchor: 'start' },
      distillate:       { px: 468, py: 335, lx: 510, ly: 355, textAnchor: 'start' },
      heat:             { px: 155, py: 310, lx: 50,  ly: 378, textAnchor: 'end'   },
    },
    svgContent: `
      <circle cx="155" cy="248" r="55" fill="#DBEAFE" stroke="#2563EB" stroke-width="2.5"/>
      <rect x="147" y="115" width="16" height="133" fill="#DBEAFE" stroke="#2563EB" stroke-width="2"/>
      <line x1="143" y1="115" x2="167" y2="115" stroke="#2563EB" stroke-width="2"/>
      <rect x="175" y="112" width="5" height="105" rx="2" fill="#FEE2E2" stroke="#DC2626" stroke-width="1"/>
      <circle cx="177" cy="218" r="6" fill="#DC2626"/>
      <line x1="175" y1="135" x2="177" y2="135" stroke="#DC2626" stroke-width="1"/>
      <line x1="175" y1="150" x2="177" y2="150" stroke="#DC2626" stroke-width="1"/>
      <line x1="175" y1="165" x2="177" y2="165" stroke="#DC2626" stroke-width="1"/>
      <line x1="175" y1="180" x2="177" y2="180" stroke="#DC2626" stroke-width="1"/>
      <path d="M108,268 Q130,305 155,305 Q180,305 202,268" fill="#BAE6FD" stroke="none" opacity="0.7"/>
      <path d="M163,155 L245,188" fill="none" stroke="#2563EB" stroke-width="10"/>
      <path d="M163,158 L245,191" fill="none" stroke="#DBEAFE" stroke-width="6"/>
      <line x1="248" y1="183" x2="432" y2="278" stroke="#374151" stroke-width="2.5"/>
      <line x1="248" y1="192" x2="432" y2="287" stroke="#374151" stroke-width="2.5"/>
      <line x1="255" y1="183" x2="425" y2="278" stroke="#374151" stroke-width="2.5"/>
      <line x1="255" y1="192" x2="425" y2="287" stroke="#374151" stroke-width="2.5"/>
      <rect x="248" y="183" width="7" height="9" fill="#6B7280"/>
      <rect x="425" y="278" width="7" height="9" fill="#6B7280"/>
      <line x1="420" y1="287" x2="420" y2="310" stroke="#374151" stroke-width="2"/>
      <line x1="258" y1="183" x2="258" y2="162" stroke="#374151" stroke-width="2"/>
      <rect x="448" y="290" width="12" height="20" fill="#DBEAFE" stroke="#2563EB" stroke-width="1.5"/>
      <path d="M437,310 L422,370 Q468,382 492,370 L480,310 Z" fill="#DBEAFE" stroke="#2563EB" stroke-width="1.5"/>
      <path d="M453,345 Q468,350 483,345" fill="#BAE6FD" stroke="none"/>
      <path d="M455,355 Q468,360 481,355" fill="#BAE6FD" stroke="none"/>
      <rect x="130" y="362" width="50" height="18" rx="3" fill="#6B7280" stroke="#374151" stroke-width="1.5"/>
      <rect x="145" y="320" width="20" height="44" fill="#9CA3AF" stroke="#374151" stroke-width="1.5"/>
      <path d="M150,320 Q148,307 155,295 Q160,307 162,300 Q158,312 158,318 Z" fill="#FCD34D"/>
      <path d="M152,318 Q150,310 155,302 Q159,310 161,306 Q159,313 157,317 Z" fill="#F97316" opacity="0.8"/>
      <line x1="130" y1="362" x2="180" y2="362" stroke="#6B7280" stroke-width="1.5"/>
    `,
  },
}

/** All available template IDs with their descriptions (for AI prompt). */
export const TEMPLATE_CATALOG: Array<{ id: string; description: string }> =
  Object.values(SVG_TEMPLATES).map(t => ({ id: t.id, description: t.description }))
