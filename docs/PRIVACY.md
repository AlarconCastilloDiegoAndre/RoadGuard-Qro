# Privacy

RoadGuard Qro captures images in public spaces from municipal vehicles. Frames may incidentally
contain people's faces or vehicle license plates, which are personal data under Mexico's
*Ley Federal de Protección de Datos Personales en Posesión de los Particulares* (LFPDPPP) and the
general law for public bodies (LGPDPPSO). The system is designed around **data minimization**.

## Technical measures

1. **Region-of-interest crop on the device** – only the bottom 60 % of each frame (the pavement)
   ever leaves the phone. Most faces and plates are in the discarded upper region.
2. **No full frames are stored** – the backend runs inference in memory and discards the frame.
3. **Only damage crops are persisted** – a small WebP crop around each detected damage is stored
   in Supabase Storage (private bucket, signed URLs for authorized engineers only).
4. **Retention** – crops of damages marked `repaired` or `dismissed` are deleted after 90 days;
   raw detection rows are aggregated and deleted after 180 days (`pg_cron`).
5. **Tenant isolation** – Row Level Security restricts every row to the municipality that owns it.
6. **Driver location** – GPS is recorded only while a route session is active, and only together
   with captured frames. It is used for damage geolocation and coverage maps, not for driver
   performance monitoring.
7. **Pilot imagery** is never committed to the public repository.

## Privacy notice (template for the capture app)

> The RoadGuard Qro application captures images of the road surface and the vehicle's GPS position
> while a route is active, for the sole purpose of detecting and geolocating pavement damage for
> the Public Works Department of the Municipality. Images are cropped to the road surface, processed
> automatically and discarded; only small images of detected damage are kept. For more information
> or to exercise your ARCO rights, contact the Municipality's Transparency Unit.
