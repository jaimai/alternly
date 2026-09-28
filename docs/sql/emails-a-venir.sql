-- E-mails de cycle de vie à venir, par compte (Postgres de production, lecture seule).
-- Reprend les conditions de backend/app/services/lifecycle.py :
--   J1 « règle manquante »  : compte de 1 à 3 jours, pas de règle de garde
--   J3 « inviter l'autre »  : compte de 3 à 7 jours, foyer encore solo
--   J7 « synchro, échanges »: compte de 7 à 10 jours, règle posée
-- Comptes exclus : placeholders, anonymisés (*.invalid), e-mails refusés.
-- Aucune donnée personnelle affichée (ni e-mail ni prénom).
WITH base AS (
  SELECT
    u.id,
    (now() AT TIME ZONE 'utc') - u.created_at AS age,
    hm.household_id,
    hm.household_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM custody_rules c WHERE c.household_id = hm.household_id) AS has_rule,
    hm.household_id IS NOT NULL AND (
      SELECT count(*) FROM household_members m JOIN users x ON x.id = m.user_id
      WHERE m.household_id = hm.household_id AND NOT x.is_placeholder
    ) >= 2 AS two_parents,
    ARRAY(SELECT kind FROM email_log e WHERE e.user_id = u.id) AS deja_envoyes
  FROM users u
  LEFT JOIN household_members hm ON hm.user_id = u.id
  WHERE NOT u.is_placeholder
    AND u.email_opt_in
    AND u.email NOT LIKE '%.invalid'
)
SELECT
  id AS user_id,
  round(extract(epoch FROM age) / 86400, 1) AS age_jours,
  has_rule AS regle_posee,
  two_parents AS deux_parents,
  deja_envoyes,
  CASE
    WHEN age < interval '1 day' AND NOT has_rule            THEN 'J1 (dès J+1)'
    WHEN age < interval '3 days' AND NOT has_rule
         AND NOT 'j1_rule' = ANY (deja_envoyes)             THEN 'J1 au prochain cron'
    WHEN age < interval '7 days' AND household_id IS NOT NULL AND NOT two_parents
         AND NOT 'j3_invite' = ANY (deja_envoyes)
      THEN CASE WHEN age >= interval '3 days' THEN 'J3 au prochain cron' ELSE 'J3 (dès J+3)' END
    WHEN age < interval '10 days' AND has_rule
         AND NOT 'j7_value' = ANY (deja_envoyes)
      THEN CASE WHEN age >= interval '7 days' THEN 'J7 au prochain cron' ELSE 'J7 (dès J+7)' END
    ELSE '—'
  END AS prochain_email
FROM base
ORDER BY age;
