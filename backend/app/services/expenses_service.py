"""Calcul du solde entre les deux parents d'un foyer (pur, sans I/O).

Montants en centimes entiers. L'arrondi de la part due se fait par dépense
(demi-pair), cohérent avec un affichage ligne à ligne.
"""
from dataclasses import dataclass


@dataclass
class Balance:
    net: dict[int, int]              # user_id -> solde net (positif = on lui doit)
    debtor_id: int | None            # qui doit
    creditor_id: int | None          # à qui
    amount_cents: int                # montant dû (>= 0), 0 si à jour


def owed_to_payer(amount_cents: int, payer_percent: int) -> int:
    """Ce que l'autre parent doit au payeur : amount × (100 − payer_percent) / 100,
    arrondi au centime (demi-pair, sans flottant)."""
    numerator = amount_cents * (100 - payer_percent)
    quotient, remainder = divmod(numerator, 100)
    twice = remainder * 2
    if twice > 100 or (twice == 100 and quotient % 2 == 1):
        quotient += 1
    return quotient


def compute_balance(expenses, settlements, member_ids: list[int]) -> Balance:
    net: dict[int, int] = {uid: 0 for uid in member_ids}

    for e in expenses:
        if getattr(e, "status", "active") != "active":
            continue
        payer = e.paid_by
        other = next((uid for uid in member_ids if uid != payer), None)
        if other is None:
            continue  # foyer solo : rien à répartir
        owed = owed_to_payer(e.amount_cents, e.payer_percent)
        net[payer] += owed
        net[other] -= owed

    for s in settlements:
        # from_user verse à to_user → règle une dette (crédite le payeur).
        if s.from_user in net:
            net[s.from_user] += s.amount_cents
        if s.to_user in net:
            net[s.to_user] -= s.amount_cents

    creditor_id = next((uid for uid, v in net.items() if v > 0), None)
    debtor_id = next((uid for uid, v in net.items() if v < 0), None)
    amount = net[creditor_id] if creditor_id is not None else 0
    return Balance(net=net, debtor_id=debtor_id, creditor_id=creditor_id, amount_cents=amount)
