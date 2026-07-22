const puppeteer = require('puppeteer-core');

(async () => {
  try {
    const browser = await puppeteer.launch({
      headless: "new",
      executablePath: '/usr/bin/google-chrome',
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled'
      ]
    });
    
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // 1. Çerezleri Yükle
    const rawCookies = JSON.parse(process.env.GOOGLE_COOKIES);
    const cleanedCookies = rawCookies.map(cookie => {
      const c = { ...cookie };
      delete c.hostOnly;
      delete c.storeId;
      if (c.sameSite === 'unspecified' || c.sameSite === 'no_restriction') delete c.sameSite;
      if (c.domain && c.domain.startsWith('.')) c.domain = c.domain.substring(1);
      return c;
    });

    await page.setCookie(...cleanedCookies);

    // 2. LSA Inbox URL'sine Git
    const targetUrl = 'https://ads.google.com/localservices/inbox?cid=2903573653&bid=10985702078&pid=9999999999&euid=3547106212&hl=de-AT&gl=AT';
    console.log("LSA Inbox sayfasına gidiliyor...");
    
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

    // Sayfa Yüklenme Beklemesi
    await new Promise(resolve => setTimeout(resolve, 8000));

    console.log("Mevcut URL:", page.url());
    console.log("Sayfa Başlığı:", await page.title());

    // 3. Iframe ve DOM Taraması
    const frames = page.frames();
    console.log(`Sayfadaki Toplam Frame/Iframe Sayısı: ${frames.length}`);

    let allLeads = [];

    // Tüm Çerçeveleri (Main Page + Iframes) Tara
    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      try {
        const frameData = await frame.evaluate(() => {
          let found = [];
          // Metin içinden Avusturya telefon numarası kalıplarını bul
          const text = document.body.innerText || '';
          const matches = text.match(/(?:06\d{2}|07\d{2}|068\d)[\s\d\/]{6,12}/g);
          
          if (matches) {
            matches.forEach(m => found.push(m.trim()));
          }
          return {
            title: document.title,
            phones: found,
            sampleText: text.substring(0, 300).replace(/\n/g, ' ')
          };
        });

        console.log(`--- Frame ${i} (${frameData.title}) ---`);
        console.log(`Örnek Metin: ${frameData.sampleText}`);
        if (frameData.phones.length > 0) {
          console.log(`Frame ${i} içinde bulunan numaralar:`, frameData.phones);
          allLeads.push(...frameData.phones);
        }
      } catch (err) {
        // Cross-origin iframe erişim hatalarını yut
      }
    }

    console.log("Toplam Bulunan Numaralar:", [...new Set(allLeads)]);

    await browser.close();
  } catch (error) {
    console.error("Scraper çalışırken hata oluştu:", error.message);
    process.exit(1);
  }
})();
