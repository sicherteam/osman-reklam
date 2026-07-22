const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

function parseCleanMessage(rawText) {
  if (!rawText || rawText === '-' || !rawText.includes('Unterhaltung')) {
    return rawText;
  }

  let customerHeader = "";
  const headerMatch = rawText.match(/(?:Potenzieller Kunde|[A-Z][a-z]+\s+[A-Z][a-z]+)\s+[\d\s]+/i);

  if (headerMatch) {
    customerHeader = headerMatch[0].trim();
  }

  let parts = rawText.split('Unterhaltung');
  let chatContent = parts[parts.length - 1];

  chatContent = chatContent
    .split('Wird geladen')[0]
    .split('Audioinhalte')[0]
    .split('Hier dem Kunden')[0]
    .trim();

  chatContent = chatContent
    .replace(/^P\s+/gi, '')
    .replace(/^Potenzieller Kunde\s+/gi, '')
    .replace(/^\d{2}\.\d{2}\.\d{2}\s+/gi, '')
    .trim();

  if (customerHeader && chatContent) {
    return `[${customerHeader}]\n${chatContent}`;
  }

  return chatContent.length > 0 ? chatContent : rawText;
}


(async () => {

let browser;

try {

console.log("🚀 GitHub Actions üzerinde Scraper başlatılıyor...");


browser = await puppeteer.launch({

  headless: "new",

  executablePath: '/usr/bin/google-chrome',

  // 🔥 Yeni eklenen kalıcı Chrome profili
  userDataDir: './chrome-profile',

  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-blink-features=AutomationControlled',
    '--disable-infobars',
    '--window-size=1920,1080',
    '--lang=de-AT,de'
  ]

});


const page = await browser.newPage();


await page.setViewport({
  width:1920,
  height:1080
});


await page.setExtraHTTPHeaders({

'Accept-Language':
'de-AT,de;q=0.9,en-US;q=0.8,en;q=0.7'

});


page.setDefaultNavigationTimeout(90000);
page.setDefaultTimeout(90000);


await page.setUserAgent(
'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
);


// Cookie yükleme şimdilik duruyor
if (!process.env.GOOGLE_COOKIES ||
process.env.GOOGLE_COOKIES.trim()==='') {

throw new Error(
"❌ GOOGLE_COOKIES secret değişkeni bulunamadı!"
);

}


console.log("📌 GOOGLE_COOKIES yükleniyor...");


const rawCookies =
JSON.parse(process.env.GOOGLE_COOKIES);


const cookies = rawCookies.map(cookie=>{

const cleaned={...cookie};

if(
cleaned.sameSite==='no_restriction' ||
cleaned.sameSite==='unspecified' ||
!cleaned.sameSite
){

delete cleaned.sameSite;

}

return cleaned;

});


await page.setCookie(...cookies);


console.log(
`✅ ${cookies.length} adet çerez yüklendi.`
);
