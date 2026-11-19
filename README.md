# VChat — maxfiy chat (Android)

Ikki (yoki undan ortiq) kishi uchun kod bilan himoyalangan chat.

- Chat yaratilganda 8 belgili **kod** va **taklif havolasi** beriladi.
- Xabarlar telefonning o'zida AES-256-GCM bilan shifrlanadi (kalit = PBKDF2(kod)). Server faqat o'qib bo'lmaydigan matnni ko'radi.
- Xabarlarni uzatish uchun bepul [ntfy.sh](https://ntfy.sh) ishlatiladi: u xabarlarni **~12 soat** saqlaydi. Telefoningizdagi tarix esa saqlanib qoladi.
- Ilova ochiq turganda xabarlar keladi (fonda bildirishnoma hali yo'q).

## APK
Har safar `main` branchiga o'zgarish kiritilganda GitHub Actions APK'ni yig'adi va uni
**Releases → latest → vchat.apk** ga joylaydi:

`https://github.com/<foydalanuvchi>/<repo>/releases/latest/download/vchat.apk`

## Taklif havolasi
Havola `https://<foydalanuvchi>.github.io/<repo>/#<xona>` ko'rinishida bo'ladi. U ishlashi uchun
**Settings → Pages → Branch: `main`, papka: `/docs`** ni yoqing.
