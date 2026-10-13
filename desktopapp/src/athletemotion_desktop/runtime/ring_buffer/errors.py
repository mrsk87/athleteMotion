"""Erros tipados do anel de frames em memória partilhada.

Porquê exceções próprias: o anel é atravessado por dois processos e um erro genérico
(`ValueError`, `RuntimeError`) não distingue «o produtor não caber no anel» de
«estou a anexar-me a uma memória partilhada com layout diferente». Cada condição tem
um caminho de recuperação diferente (descartar o frame vs. abortar o arranque).
"""

from __future__ import annotations


class RingBufferError(RuntimeError):
    """Erro base de qualquer falha no anel de frames."""


class RingBufferLayoutError(RingBufferError):
    """A memória partilhada não corresponde ao layout esperado.

    Args:
        name: nome do segmento de memória partilhada.
        reason: descrição concreta da divergência encontrada.
    """

    def __init__(self, name: str, reason: str) -> None:
        self.name = name
        self.reason = reason
        super().__init__(f"Layout inválido em '{name}': {reason}")


class RingBufferOwnershipError(RingBufferError):
    """Operação reservada ao dono do segmento (ex.: `unlink`) tentada por outro processo.

    Args:
        name: nome do segmento de memória partilhada.
        operation: operação recusada.
    """

    def __init__(self, name: str, operation: str) -> None:
        self.name = name
        self.operation = operation
        super().__init__(
            f"'{operation}' só pode ser executada pelo processo que criou o anel '{name}'."
        )


class RingBufferClosedError(RingBufferError):
    """Operação tentada depois de o anel ter sido fechado.

    Args:
        name: nome do segmento de memória partilhada.
    """

    def __init__(self, name: str) -> None:
        self.name = name
        super().__init__(f"O anel '{name}' já foi fechado.")


class RingBufferStateError(RingBufferError):
    """Chamada de protocolo fora de ordem (ex.: `commit` sem `acquire_write`).

    Args:
        name: nome do segmento.
        operation: operação recusada.
        reason: o que faltava para a operação ser válida.
    """

    def __init__(self, name: str, operation: str, reason: str) -> None:
        self.name = name
        self.operation = operation
        self.reason = reason
        super().__init__(f"'{operation}' inválida no anel '{name}': {reason}")


class RingBufferFullError(RingBufferError):
    """Todos os slots estão em leitura: escrever agora corromperia um frame em uso.

    O produtor **nunca** espera por um slot: em tempo real, descartar o frame novo é
    preferível a acumular latência (política *latest-wins* do plano §4.1).

    Args:
        n_slots: número de slots do anel.
    """

    def __init__(self, n_slots: int) -> None:
        self.n_slots = n_slots
        super().__init__(
            f"Sem slot livre nos {n_slots} slots do anel: o consumidor tem todos em leitura "
            "(o frame novo foi descartado, conforme a política latest-wins)."
        )


class TornFrameError(RingBufferError):
    """O produtor reutilizou o slot enquanto o consumidor o estava a ler.

    No anel SPSC esta janela é inerente (a marca de leitura não é um *compare-and-swap*)
    e está **detetada**, não escondida: em tempo real o consumidor descarta o frame
    (`ShmRing.release` devolve `False`) e volta a pedir o mais recente; em modo offline
    (`latest=False`) perder o frame esperado é perda de dados e sobe como erro, porque
    um relatório com frames em falta tem de o dizer — nunca contar um frame a menos em
    silêncio.
    """

    def __init__(self, index: int, expected_seq: int, observed_seq: int) -> None:
        self.index = index
        self.expected_seq = expected_seq
        self.observed_seq = observed_seq
        super().__init__(
            f"Frame rasgado no slot {index}: esperava a sequência {expected_seq}, "
            f"encontrei {observed_seq} (o produtor reescreveu o slot durante a leitura)."
        )
