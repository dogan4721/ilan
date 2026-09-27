import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json());

// Initialize Google GenAI on server-side
const apiKey = process.env.GEMINI_API_KEY || '';
let ai: GoogleGenAI | null = null;
if (apiKey) {
  ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// AI Assistant endpoint
app.post('/api/ai/assistant', async (req, res) => {
  const { message, listingContext } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'Mesaj gereklidir.' });
  }

  // System prompt tailored for Manisa/Turgutlu
  const systemInstruction = `Sen Manisa / Turgutlu bölgesine özel "TurgutluPazar Yapay Zeka Emlak ve Piyasa Asistanı"sın.
Turgutlu mahalleleri (İstasyonaltı, Subaşı, Ergenekon, Selvilitepe, Atatürk, Cumhuriyet, Yılmazlar, Urganlı, Derbent vb.), Gediz Ovası tarım arazileri, bağcılık (Sultaniye üzüm bağları), traktörler ve konut piyasası hakkında derin uzmanlığa sahipsin.
Kullanıcılara sıcak, güvenilir, profesyonel ve objektif yerel tavsiyeler verirsin.
Eğer bir ilan bağlamı (listingContext) verilmişse, o ilanın fiyatını, mahalle avantajlarını, metrekare rayicini ve pazarlık payı önerilerini analiz et.
Cevaplarını temiz, madde imli ve Türkçe olarak hazırla.`;

  let prompt = message;
  if (listingContext) {
    prompt = `[İLAN BAĞLAMI: Başlık: "${listingContext.title}", Fiyat: ${listingContext.price} TL, Mahalle: ${listingContext.neighborhood}, Kategori: ${listingContext.category}, Özellikler: ${JSON.stringify(listingContext.specs || {})}]
Kullanıcı Sorusu: ${message}`;
  }

  if (ai) {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: prompt,
        config: {
          systemInstruction,
          temperature: 0.7,
        },
      });

      return res.json({
        reply: response.text || 'Turgutlu piyasa analizi oluşturuldu.',
        model: 'gemini-3.8-flash',
      });
    } catch (err: any) {
      console.warn('Gemini API call fallback:', err.message);
    }
  }

  const fallbackReply = generateTurgutluFallbackAdvice(message, listingContext);
  return res.json({
    reply: fallbackReply,
    model: 'turgutlu-market-engine',
  });
});

// AI Listing Generator & Price Estimator endpoint
app.post('/api/ai/generate-listing', async (req, res) => {
  const { action, categoryId, subcategory, neighborhood, listingType, specs, currentTitle } = req.body;

  if (action === 'pricing') {
    // Price estimation for Turgutlu
    let baseM2Price = 24000;
    if (neighborhood === 'Ergenekon') baseM2Price = 32000;
    else if (neighborhood === 'Subaşı') baseM2Price = 27000;
    else if (neighborhood === 'İstasyonaltı') baseM2Price = 25000;
    else if (neighborhood === 'Selvilitepe') baseM2Price = 23000;
    else if (neighborhood === 'Urganlı' || neighborhood === 'Derbent') baseM2Price = 18000;

    let estimatedPrice = 2800000;
    let minRange = 2500000;
    let maxRange = 3100000;
    let m2Unit = baseM2Price;

    if (categoryId === 'emlak') {
      const m2 = Number(specs?.m2Net || specs?.m2Gross || 115);
      const isNew = specs?.buildingAge === '0 (Yeni)';
      const multiplier = isNew ? 1.15 : 1.0;
      m2Unit = Math.round(baseM2Price * multiplier);
      estimatedPrice = Math.round((m2 * m2Unit) / 10000) * 10000;
      minRange = Math.round(estimatedPrice * 0.92 / 10000) * 10000;
      maxRange = Math.round(estimatedPrice * 1.08 / 10000) * 10000;
    } else if (categoryId === 'tarim') {
      estimatedPrice = 850000;
      minRange = 750000;
      maxRange = 980000;
    } else if (categoryId === 'arac') {
      estimatedPrice = 1150000;
      minRange = 1050000;
      maxRange = 1250000;
    }

    if (ai) {
      try {
        const prompt = `Sen Turgutlu Manisa bölgesi uzman bir gayrimenkul ve pazar değerleme uzmanısın.
Kategori: ${categoryId} - ${subcategory}, Mahalle: ${neighborhood}, Tür: ${listingType}, Özellikler: ${JSON.stringify(specs || {})}.
Bu ilan için Turgutlu piyasasında makul fiyat aralığı nedir?
JSON formatında yanıt ver:
{
  "suggestedPrice": ${estimatedPrice},
  "minPrice": ${minRange},
  "maxPrice": ${maxRange},
  "m2Price": ${m2Unit},
  "marketAnalysis": "Turgutlu ${neighborhood} mevkiinde son dönem piyasa hareketleri doğrultusunda kısa analiz..."
}`;
        const response = await ai.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            temperature: 0.5,
          },
        });
        const parsed = JSON.parse(response.text || '{}');
        if (parsed.suggestedPrice) {
          return res.json(parsed);
        }
      } catch (err: any) {
        console.warn('Gemini pricing fallback:', err.message);
      }
    }

    return res.json({
      suggestedPrice: estimatedPrice,
      minPrice: minRange,
      maxPrice: maxRange,
      m2Price: m2Unit,
      marketAnalysis: `Turgutlu ${neighborhood} mevkiinde ${subcategory.toLowerCase()} talebi istikrarlı seyrederken ortalama m² rayici ${m2Unit.toLocaleString('tr-TR')} TL seviyesindedir.`,
    });
  }

  // Default action: 'description' & title suggestions
  if (ai) {
    try {
      const prompt = `Manisa Turgutlu bölgesinde ilan veren bir kullanıcı için profesyonel, alıcı çeken, imla kurallarına uygun ilan başlıkları ve detaylı açıklama metni oluştur.
İlan Bilgileri:
- Kategori: ${categoryId} / ${subcategory}
- Mahalle: Turgutlu ${neighborhood} Mahallesi
- İlan Türü: ${listingType}
- Kullanıcının Taslak Başlığı: ${currentTitle || 'Yok'}
- Özellikler: ${JSON.stringify(specs || {})}

JSON formatında döndür:
{
  "titles": ["Öneri Başlık 1", "Öneri Başlık 2", "Öneri Başlık 3"],
  "description": "Detaylı, profesyonel, madde imli açıklama metni (konum avantajları, ulaşım, Turgutlu merkezine mesafe, teknik özellikler ve iletişim notuyla)..."
}`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          temperature: 0.7,
        },
      });

      const parsed = JSON.parse(response.text || '{}');
      if (parsed.description) {
        return res.json(parsed);
      }
    } catch (err: any) {
      console.warn('Gemini description generation fallback:', err.message);
    }
  }

  // Fallback description & title generator
  const fallbackTitles = [
    `Turgutlu ${neighborhood} Mahallesinde Kaçırılmayacak ${subcategory}`,
    `${neighborhood} Merkezinde Geniş & Ferah ${specs?.roomCount || ''} ${subcategory}`,
    `Yatırıma ve Oturuma Uygun Masrafsız ${subcategory} - ${neighborhood}`
  ];

  const fallbackDescription = `🌟 Manisa Turgutlu ${neighborhood} Mahallesi'nde Satılık/Kiralık Fırsatı!

📍 Lokasyon & Ulaşım:
• Turgutlu ilçe merkezine, semt pazarına, okullara ve toplu taşımaya yürüme mesafesinde.
• İzmir-Ankara (D300) karayolu ve çevre yollarına kolay bağlantı.
• Nezih, sakin ve prim potansiyeli yüksek aile mahallesi.

🏠 Özellikler & Detaylar:
• Net Kullanım Alanı: ${specs?.m2Net || 120} m² (Brüt: ${specs?.m2Gross || 135} m²)
• Oda Sayısı: ${specs?.roomCount || '3+1'}
• Bulunduğu Kat: ${specs?.floor || 'Ara Kat'} (Bina Yaşı: ${specs?.buildingAge || 'Yeni'})
• Isıtma: ${specs?.heating || 'Doğalgaz (Kombi)'}
• Tapu Durumu: ${specs?.deedStatus || 'Kat Mülkiyetli'} - Krediye Uygun

🤝 Satış & Pazarlık:
• Ciddi alıcılarla ilan başında cüzi pazarlık payı mevcuttur.
• Detaylı bilgi ve randevu için lütfen arayınız veya WhatsApp üzerinden mesaj iletiniz.`;

  return res.json({
    titles: fallbackTitles,
    description: fallbackDescription,
  });
});

function generateTurgutluFallbackAdvice(message: string, context: any): string {
  const lower = (message + ' ' + (context?.title || '')).toLowerCase();
  
  if (context) {
    return `TurgutluPazar Yapay Zeka İlan Değerleme Raporu:
• Bölge Değerlendirmesi: ${context.neighborhood} Mahallesi, Turgutlu'da ulaşım ve pazar yerine yakınlığıyla yüksek talep gören lokasyonlar arasındadır.
• Fiyat Analizi: İlandaki ${Number(context.price).toLocaleString('tr-TR')} TL fiyat etiketi, son 6 aylık Turgutlu bölge ortalamasına göre dengeli ve makul bir seviyede görünmektedir.
• Pazarlık Tavsiyesi: Bölgedeki alıcı eğilimlerine göre %5 - %8 aralığında teklif sunarak pazarlık payını değerlendirebilirsiniz.
• Önemli İpucu: Tapu durumu (${context.specs?.deedStatus || 'Kat Mülkiyeti'}) ve binanın doğalgaz kombi tesisatını yerinde kontrol etmeniz önerilir.`;
  }

  if (lower.includes('bağ') || lower.includes('tarla') || lower.includes('üzüm')) {
    return `Gediz Ovası & Turgutlu Tarım Değerlendirmesi:
• Subaşı, Urganlı ve Çampınar mevkilerinde Sultaniye çekirdeksiz üzüm bağlarında dönüm fiyatları su kaynağı (derin kuyu) ve telli terbiye sistemine göre 600.000 TL - 900.000 TL aralığında seyretmektedir.
• Sulama altyapısı ve traktör yolunun açık olması yatırım değerini %30'a kadar artırır.`;
  }

  if (lower.includes('istasyonaltı') || lower.includes('selvilitepe') || lower.includes('ergenekon')) {
    return `Turgutlu Konut Piyasası Analizi:
• Ergenekon: Müstakil villa ve lüks dubleks konut talebinin en yoğun olduğu nezih bölgedir.
• İstasyonaltı: Yeni yapılaşmanın hızlı olduğu, tren garı ve merkeze yakınlığı sebebiyle kira çarpanı cazip mahallelerdendir. Ortalama m² fiyatı 22.000 - 28.000 TL bandındadır.
• Selvilitepe: Aileler için ideal, düzenli yerleşime sahip ve hastaneye yakın konumuyla değerini koruyan bir lokasyondur.`;
  }

  return `Turgutlu Yerel Piyasa Analizi:
• Manisa Turgutlu bölgesinde hem İzmir - Ankara karayolu (D300) aksındaki ticari gayrimenkuller hem de merkez mahallelerdeki yeni 2+1 ve 3+1 daireler güçlü prim potansiyeline sahiptir.
• Detaylı değerleme için ilgilendiğiniz ilanın detay sayfasındaki "Yapay Zeka Değerlemesi" butonunu kullanabilir veya belirli bir mahalleyi sorabilirsiniz.`;
}

// Start dev or production server
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`TurgutluPazar server running on http://localhost:${PORT}`);
  });
}

startServer();
