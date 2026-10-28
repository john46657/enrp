# apps/worker – optionale Hintergrundjobs

> **Optional und noch nicht angelegt.** Ein Worker kommt erst, wenn es einen konkreten Bedarf gibt,
> z. B. regelmäßige Statusabfragen für das TikTok-LIVE-Modul (Phase 6) oder Aufräumjobs für alte Heartbeats.

Anforderungen, sobald er gebaut wird: idempotente Jobs, dokumentierte Wiederholungsversuche, keine
doppelten Benachrichtigungen nach Neustarts.
