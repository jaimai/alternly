"""Calcul de solde entre deux parents (service pur, sans I/O)."""
from dataclasses import dataclass

from app.services.expenses_service import compute_balance, outstanding_for, owed_to_payer


@dataclass
class Exp:
    paid_by: int
    amount_cents: int
    payer_percent: int = 50
    status: str = "active"
    settled_at: object = None


@dataclass
class Settle:
    from_user: int
    to_user: int
    amount_cents: int


A, B = 1, 2
MEMBERS = [A, B]


class TestOwedToPayer:
    def test_half(self):
        assert owed_to_payer(1000, 50) == 500

    def test_adjusted_share(self):
        # payeur assume 30 % → l'autre doit 70 %
        assert owed_to_payer(1000, 30) == 700

    def test_full_on_payer(self):
        # payeur assume 100 % → l'autre ne doit rien
        assert owed_to_payer(1000, 100) == 0

    def test_bankers_rounding_half_to_even(self):
        # 1001 * 50 / 100 = 500.5 → arrondi demi-pair → 500 (pair)
        assert owed_to_payer(1001, 50) == 500
        # 1003 * 50 / 100 = 501.5 → arrondi demi-pair → 502 (pair)
        assert owed_to_payer(1003, 50) == 502


class TestComputeBalance:
    def test_single_5050(self):
        bal = compute_balance([Exp(paid_by=A, amount_cents=1000)], [], MEMBERS)
        assert bal.net[A] == 500 and bal.net[B] == -500
        assert bal.creditor_id == A and bal.debtor_id == B
        assert bal.amount_cents == 500

    def test_two_expenses_offset(self):
        # A paie 1000 (B doit 500), B paie 400 (A doit 200) → net B doit 300 à A
        exps = [Exp(paid_by=A, amount_cents=1000), Exp(paid_by=B, amount_cents=400)]
        bal = compute_balance(exps, [], MEMBERS)
        assert bal.creditor_id == A and bal.debtor_id == B
        assert bal.amount_cents == 300

    def test_settlement_reduces_balance(self):
        # A a avancé → B doit 500 ; B rembourse 500 → à jour
        exps = [Exp(paid_by=A, amount_cents=1000)]
        setts = [Settle(from_user=B, to_user=A, amount_cents=500)]
        bal = compute_balance(exps, setts, MEMBERS)
        assert bal.amount_cents == 0
        assert bal.debtor_id is None and bal.creditor_id is None

    def test_settlement_can_flip_balance(self):
        # B doit 500 mais rembourse 800 → maintenant A doit 300 à B
        exps = [Exp(paid_by=A, amount_cents=1000)]
        setts = [Settle(from_user=B, to_user=A, amount_cents=800)]
        bal = compute_balance(exps, setts, MEMBERS)
        assert bal.creditor_id == B and bal.debtor_id == A
        assert bal.amount_cents == 300

    def test_disputed_expense_excluded(self):
        exps = [
            Exp(paid_by=A, amount_cents=1000),
            Exp(paid_by=A, amount_cents=2000, status="disputed"),
        ]
        bal = compute_balance(exps, [], MEMBERS)
        assert bal.amount_cents == 500  # seule la dépense active compte

    def test_settled_when_zero(self):
        bal = compute_balance([], [], MEMBERS)
        assert bal.amount_cents == 0
        assert bal.debtor_id is None and bal.creditor_id is None

    def test_settled_expense_excluded(self):
        # une dépense marquée remboursée ne pèse plus dans le solde
        exps = [
            Exp(paid_by=A, amount_cents=1000),
            Exp(paid_by=A, amount_cents=2000, settled_at="2026-07-20T10:00:00"),
        ]
        bal = compute_balance(exps, [], MEMBERS)
        assert bal.amount_cents == 500  # seule la dépense non réglée compte


class TestOutstanding:
    def test_gross_directional_amounts(self):
        # A a avancé 1000 (B lui doit 500) ; B a avancé 400 (A lui doit 200).
        exps = [Exp(paid_by=A, amount_cents=1000), Exp(paid_by=B, amount_cents=400)]
        owed_to_me, i_owe = outstanding_for(exps, me_id=A, other_id=B)
        assert owed_to_me == 500  # ce qu'on me doit
        assert i_owe == 200       # ce que je dois

    def test_ignores_settled_and_disputed(self):
        exps = [
            Exp(paid_by=A, amount_cents=1000),
            Exp(paid_by=A, amount_cents=2000, settled_at="x"),
            Exp(paid_by=A, amount_cents=4000, status="disputed"),
        ]
        owed_to_me, i_owe = outstanding_for(exps, me_id=A, other_id=B)
        assert owed_to_me == 500 and i_owe == 0
