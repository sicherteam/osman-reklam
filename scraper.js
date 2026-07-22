const puppeteer = require('puppeteer-core');

(async () => {
  try {
    const browser = await puppeteer.launch({
      headless: "new",
      executablePath: '/usr/bin/google-chrome',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();

    // 1. Çerezleri yükle
    const cookies = JSON.parse(process.env.GOOGLE_COOKIES);
    await page.setCookie(...cookies);

    // 2. LSA Inbox URL'sine git
    const targetUrl = 'https://ads.google.com/localservices/inbox?cid=2903573653&bid=10985702078&pid=9999999999&euid=3547106212&hl=de-AT&gl=AT';
    console.log("LSA Inbox sayfasına gidiliyor...");
    
    await page.goto(targetUrl, { waitUntil: 'networkidle2' });

    // Sayfa başlığını ve URL'yi logla (Oturum açık mı kontrolü)
    console.log("Sayfa Başlığı:", await page.title());
    console.log("Mevcut URL:", page.url());

    // 3. İçeriğin tam yüklenmesi için 8 saniye bekle
    await new Promise(resolve => setTimeout(resolve, 8000));

    // 4. Dinamik Yapıyı Tara
    const result = await page.evaluate(() => {
      let leads = [];

      // A) YÖNTEM 1: Role-based grid / row taraması (Google Material / Angular)
      const rows = document.querySelectorAll('[role="row"], .lead-row, tr, div[class*="row"]');
      
      rows.forEach(row => {
        const text = row.innerText || '';
        // Telefon numarası içeren satırları yakala (Örn: 0699, 0676, 0664 ile başlayanlar)
        if (/\b06\d{2}[\s\d]+\b/.test(text) || /\b07\d{2}[\s\d]+\b/.test(text)) {
          const parts = text.split('\n').map(s => s.trim()).filter(Boolean);
          if (parts.length > 0) {
            leads.push({
              phone: parts[0],
              details: parts.slice(1).join(' | ')
            });
          }
        }
      });

      // B) YÖNTEM 2: Eğer yukarıdaki boş döndüyse, tüm sayfadaki regex eşleşmelerini al
      if (leads.length === 0) {
        const bodyText = document.body.innerText;
        // Avusturya telefon numarası kalıbı (06xx xxx xxx)
        const matches = bodyText.match(/(?:06\d{2}|07\d{2})[\s\d\/]{6,12}/g);
        if (matches) {
          const uniquePhones = [...new Set(matches.map(m => m.trim()))];
          leads = uniquePhones.map(phone => ({ phone, details: 'Regex ile çekildi' }));
        }
      }

      return {
        count: leads.length,
        leads: leads,
        bodyLength: document.body.innerText.length
      };
    });

    console.log("Sayfa Metin Boyutu (Char):", result.bodyLength);
    console.log("Çekilen Canlı Veri Sayısı:", result.count);
    console.log("Çekilen Canlı Veriler:", JSON.stringify(result.leads, null, 2));

    await browser.close();
  } catch (error) {
    console.error("Scraper çalışırken hata oluştu:", error);
    process.exit(1);
  }
})();
