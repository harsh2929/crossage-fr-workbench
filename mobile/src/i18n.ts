export type MobileTextKey =
  | "library"
  | "search"
  | "session"
  | "recentPhotos"
  | "collections"
  | "photos"
  | "albums"
  | "keywords"
  | "duplicates"
  | "searchPlaceholder"
  | "searchAction"
  | "loadMore"
  | "noResults"
  | "noResultsDetail"
  | "details"
  | "captured"
  | "dimensions"
  | "people"
  | "objects"
  | "text"
  | "close"
  | "refresh"
  | "readOnly"
  | "previewsOn"
  | "previewsOff"
  | "expires"
  | "disconnect"
  | "pairedDevice"
  | "pairing"
  | "loading"
  | "disconnected"
  | "disconnectedDetail"
  | "pairAgain"
  | "secureOriginRequired"
  | "pairingFailed"
  | "libraryUnavailable"
  | "previewUnavailable"
  | "safeMode"
  | "video"
  | "image"
  | "allPhotos"
  | "offline"
  | "metadataOnly";

const english: Record<MobileTextKey, string> = {
  library: "Library",
  search: "Search",
  session: "Session",
  recentPhotos: "Recent photos",
  collections: "Collections",
  photos: "Photos",
  albums: "Albums",
  keywords: "Keywords",
  duplicates: "Duplicate groups",
  searchPlaceholder: "Search photos, places, text, or objects",
  searchAction: "Search",
  loadMore: "Load more",
  noResults: "No photos found",
  noResultsDetail: "Try a different phrase or refresh the library.",
  details: "Details",
  captured: "Captured",
  dimensions: "Dimensions",
  people: "People",
  objects: "Objects",
  text: "Text",
  close: "Close",
  refresh: "Refresh",
  readOnly: "Read only",
  previewsOn: "Photo previews enabled",
  previewsOff: "Metadata only",
  expires: "Expires",
  disconnect: "Disconnect this browser",
  pairedDevice: "Paired device",
  pairing: "Pairing securely",
  loading: "Loading your library",
  disconnected: "Mobile access is disconnected",
  disconnectedDetail: "Create a new pairing link in the Vintrace desktop app.",
  pairAgain: "Open a new pairing link",
  secureOriginRequired: "Mobile pairing requires a trusted HTTPS connection.",
  pairingFailed: "This pairing link is invalid, expired, or already used.",
  libraryUnavailable: "The library is unavailable right now.",
  previewUnavailable: "Preview unavailable",
  safeMode: "Protected by Safe Mode",
  video: "Video",
  image: "Image",
  allPhotos: "All photos",
  offline: "You appear to be offline.",
  metadataOnly: "Preview access is off for this device.",
};

const translations: Partial<Record<string, Partial<Record<MobileTextKey, string>>>> = {
  es: {
    library: "Biblioteca", search: "Buscar", session: "Sesión", recentPhotos: "Fotos recientes",
    collections: "Colecciones", photos: "Fotos", albums: "Álbumes", keywords: "Palabras clave",
    duplicates: "Grupos duplicados", searchPlaceholder: "Busca fotos, lugares, texto u objetos",
    searchAction: "Buscar", loadMore: "Cargar más", noResults: "No se encontraron fotos",
    noResultsDetail: "Prueba otra frase o actualiza la biblioteca.", details: "Detalles", captured: "Capturada",
    dimensions: "Dimensiones", people: "Personas", objects: "Objetos", text: "Texto", close: "Cerrar",
    refresh: "Actualizar", readOnly: "Solo lectura", previewsOn: "Vistas previas activadas",
    previewsOff: "Solo metadatos", expires: "Caduca", disconnect: "Desconectar este navegador",
    pairedDevice: "Dispositivo vinculado", pairing: "Vinculando de forma segura", loading: "Cargando tu biblioteca",
    disconnected: "El acceso móvil está desconectado", disconnectedDetail: "Crea un nuevo enlace en Vintrace para escritorio.",
    secureOriginRequired: "La vinculación móvil requiere una conexión HTTPS de confianza.",
    pairingFailed: "Este enlace no es válido, ha caducado o ya se usó.", libraryUnavailable: "La biblioteca no está disponible ahora.",
    previewUnavailable: "Vista previa no disponible", safeMode: "Protegida por Modo seguro", video: "Vídeo", image: "Imagen",
    allPhotos: "Todas las fotos", offline: "Parece que no tienes conexión.", metadataOnly: "Las vistas previas están desactivadas para este dispositivo.",
  },
  fr: {
    library: "Photothèque", search: "Rechercher", session: "Session", recentPhotos: "Photos récentes",
    collections: "Collections", photos: "Photos", albums: "Albums", keywords: "Mots-clés", duplicates: "Groupes de doublons",
    searchPlaceholder: "Rechercher des photos, lieux, textes ou objets", searchAction: "Rechercher", loadMore: "Afficher plus",
    noResults: "Aucune photo trouvée", noResultsDetail: "Essayez une autre expression ou actualisez la photothèque.",
    details: "Détails", captured: "Prise le", dimensions: "Dimensions", people: "Personnes", objects: "Objets", text: "Texte",
    close: "Fermer", refresh: "Actualiser", readOnly: "Lecture seule", previewsOn: "Aperçus activés", previewsOff: "Métadonnées uniquement",
    expires: "Expire", disconnect: "Déconnecter ce navigateur", pairedDevice: "Appareil associé", pairing: "Association sécurisée",
    loading: "Chargement de votre photothèque", disconnected: "L'accès mobile est déconnecté",
    disconnectedDetail: "Créez un nouveau lien dans l'application Vintrace.", secureOriginRequired: "L'association mobile exige une connexion HTTPS fiable.",
    pairingFailed: "Ce lien est invalide, expiré ou déjà utilisé.", libraryUnavailable: "La photothèque est indisponible pour le moment.",
    previewUnavailable: "Aperçu indisponible", safeMode: "Protégée par le Mode sécurisé", video: "Vidéo", image: "Image",
    allPhotos: "Toutes les photos", offline: "Vous semblez hors ligne.", metadataOnly: "Les aperçus sont désactivés pour cet appareil.",
  },
  ja: {
    library: "ライブラリ", search: "検索", session: "セッション", recentPhotos: "最近の写真", collections: "コレクション",
    photos: "写真", albums: "アルバム", keywords: "キーワード", duplicates: "重複グループ",
    searchPlaceholder: "写真、場所、文字、物を検索", searchAction: "検索", loadMore: "さらに表示", noResults: "写真が見つかりません",
    noResultsDetail: "別の言葉で検索するか、更新してください。", details: "詳細", captured: "撮影日", dimensions: "サイズ",
    people: "人物", objects: "物", text: "テキスト", close: "閉じる", refresh: "更新", readOnly: "読み取り専用",
    previewsOn: "プレビュー有効", previewsOff: "メタデータのみ", expires: "有効期限", disconnect: "このブラウザを切断",
    pairedDevice: "ペアリング済み端末", pairing: "安全にペアリング中", loading: "ライブラリを読み込み中",
    disconnected: "モバイルアクセスは切断されています", disconnectedDetail: "デスクトップ版Vintraceで新しいリンクを作成してください。",
    secureOriginRequired: "モバイルのペアリングには信頼できるHTTPS接続が必要です。", pairingFailed: "リンクが無効、期限切れ、または使用済みです。",
    libraryUnavailable: "現在ライブラリを利用できません。", previewUnavailable: "プレビュー不可", safeMode: "セーフモードで保護",
    video: "ビデオ", image: "画像", allPhotos: "すべての写真", offline: "オフラインのようです。", metadataOnly: "この端末ではプレビューが無効です。",
  },
  zh: {
    library: "图库", search: "搜索", session: "会话", recentPhotos: "最近照片", collections: "收藏", photos: "照片",
    albums: "相册", keywords: "关键词", duplicates: "重复组", searchPlaceholder: "搜索照片、地点、文字或物体",
    searchAction: "搜索", loadMore: "加载更多", noResults: "未找到照片", noResultsDetail: "请尝试其他关键词或刷新图库。",
    details: "详情", captured: "拍摄时间", dimensions: "尺寸", people: "人物", objects: "物体", text: "文字", close: "关闭",
    refresh: "刷新", readOnly: "只读", previewsOn: "已启用预览", previewsOff: "仅元数据", expires: "到期时间",
    disconnect: "断开此浏览器", pairedDevice: "已配对设备", pairing: "正在安全配对", loading: "正在加载图库",
    disconnected: "移动访问已断开", disconnectedDetail: "请在 Vintrace 桌面应用中创建新的配对链接。",
    secureOriginRequired: "移动配对需要可信的 HTTPS 连接。", pairingFailed: "此链接无效、已过期或已使用。",
    libraryUnavailable: "图库暂时不可用。", previewUnavailable: "预览不可用", safeMode: "受安全模式保护", video: "视频",
    image: "图片", allPhotos: "所有照片", offline: "当前似乎处于离线状态。", metadataOnly: "此设备已关闭预览访问。",
  },
  hi: {
    library: "लाइब्रेरी", search: "खोज", session: "सत्र", recentPhotos: "हाल की फ़ोटो", collections: "संग्रह",
    photos: "फ़ोटो", albums: "एल्बम", keywords: "कीवर्ड", duplicates: "डुप्लिकेट समूह",
    searchPlaceholder: "फ़ोटो, जगह, टेक्स्ट या वस्तु खोजें", searchAction: "खोजें", loadMore: "और दिखाएँ",
    noResults: "कोई फ़ोटो नहीं मिली", noResultsDetail: "दूसरे शब्द आज़माएँ या लाइब्रेरी रीफ़्रेश करें।", details: "विवरण",
    captured: "खींची गई", dimensions: "आकार", people: "लोग", objects: "वस्तुएँ", text: "टेक्स्ट", close: "बंद करें",
    refresh: "रीफ़्रेश", readOnly: "केवल पढ़ने योग्य", previewsOn: "फ़ोटो प्रीव्यू चालू", previewsOff: "केवल मेटाडेटा",
    expires: "समाप्ति", disconnect: "इस ब्राउज़र को डिस्कनेक्ट करें", pairedDevice: "जुड़ा हुआ डिवाइस",
    pairing: "सुरक्षित रूप से जोड़ा जा रहा है", loading: "लाइब्रेरी लोड हो रही है", disconnected: "मोबाइल एक्सेस डिस्कनेक्ट है",
    disconnectedDetail: "Vintrace डेस्कटॉप ऐप में नया पेयरिंग लिंक बनाएँ।", secureOriginRequired: "मोबाइल पेयरिंग के लिए विश्वसनीय HTTPS कनेक्शन चाहिए।",
    pairingFailed: "यह लिंक अमान्य, समाप्त या पहले इस्तेमाल हो चुका है।", libraryUnavailable: "लाइब्रेरी अभी उपलब्ध नहीं है।",
    previewUnavailable: "प्रीव्यू उपलब्ध नहीं", safeMode: "सेफ़ मोड से सुरक्षित", video: "वीडियो", image: "चित्र",
    allPhotos: "सभी फ़ोटो", offline: "आप ऑफ़लाइन लगते हैं।", metadataOnly: "इस डिवाइस के लिए प्रीव्यू बंद हैं।",
  },
  ar: {
    library: "المكتبة", search: "بحث", session: "الجلسة", recentPhotos: "الصور الحديثة", collections: "المجموعات",
    photos: "الصور", albums: "الألبومات", keywords: "الكلمات المفتاحية", duplicates: "مجموعات التكرار",
    searchPlaceholder: "ابحث عن صور أو أماكن أو نصوص أو عناصر", searchAction: "بحث", loadMore: "عرض المزيد",
    noResults: "لم يتم العثور على صور", noResultsDetail: "جرّب عبارة أخرى أو حدّث المكتبة.", details: "التفاصيل",
    captured: "تاريخ الالتقاط", dimensions: "الأبعاد", people: "الأشخاص", objects: "العناصر", text: "النص", close: "إغلاق",
    refresh: "تحديث", readOnly: "للقراءة فقط", previewsOn: "معاينات الصور مفعّلة", previewsOff: "بيانات وصفية فقط",
    expires: "تنتهي", disconnect: "فصل هذا المتصفح", pairedDevice: "الجهاز المقترن", pairing: "جارٍ الاقتران الآمن",
    loading: "جارٍ تحميل المكتبة", disconnected: "تم فصل الوصول عبر الهاتف", disconnectedDetail: "أنشئ رابط اقتران جديدًا في تطبيق Vintrace لسطح المكتب.",
    secureOriginRequired: "يتطلب الاقتران اتصال HTTPS موثوقًا.", pairingFailed: "هذا الرابط غير صالح أو منتهي أو مستخدم سابقًا.",
    libraryUnavailable: "المكتبة غير متاحة الآن.", previewUnavailable: "المعاينة غير متاحة", safeMode: "محمية بالوضع الآمن",
    video: "فيديو", image: "صورة", allPhotos: "كل الصور", offline: "يبدو أنك غير متصل.", metadataOnly: "المعاينات معطلة لهذا الجهاز.",
  },
};

export function mobileLocale() {
  const language = String(navigator.language || "en").toLowerCase().split("-")[0];
  return translations[language] ? language : "en";
}

export function mobileDirection(locale: string) {
  return locale === "ar" ? "rtl" : "ltr";
}

export function mobileText(locale: string, key: MobileTextKey) {
  return translations[locale]?.[key] || english[key];
}
