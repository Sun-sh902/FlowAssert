"""Experimental metadata types, separate from generated frozen HTTP models."""
from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field

Sha256 = Annotated[str, Field(pattern=r'^[0-9a-f]{64}$')]


class RunBoundExecutionContext(BaseModel):
    model_config = ConfigDict(strict=True, extra='forbid')
    run_id: Annotated[str, Field(min_length=1)]
    execution_cwd_sha256: Sha256
    source_basis_sha256: Sha256
    rule_basis_sha256: Sha256
    started_mono_ns: Annotated[int, Field(ge=0)]
    completed_mono_ns: Annotated[int, Field(ge=0)]
    verifier_work_completed: bool
    outer_exit_status: Union[int, None]
    subprocess_failures: Annotated[int, Field(ge=0)]


class RunBoundEvidenceReceipt(BaseModel):
    model_config = ConfigDict(strict=True, extra='forbid')
    run_id: Annotated[str, Field(min_length=1)]
    execution_cwd_sha256: Sha256
    input_sha256: Union[Sha256, None] = None
    result_sha256: Union[Sha256, None] = None
    token: Union[Sha256, None] = None


class AdmissionEvaluation(BaseModel):
    model_config = ConfigDict(strict=True, extra='forbid')
    capture_status: Literal['CAPTURED_COMPLETE', 'CAPTURE_INCOMPLETE', 'CAPTURE_STALE_REJECTED', 'CAPTURE_SUBPROCESS_FAILED', 'CAPTURE_NOT_IMPLEMENTED']
    admission_status: Literal['ADMITTED_RUN_BOUND', 'REJECTED_STALE_RECEIPT', 'REJECTED_INCOMPLETE_EXECUTION', 'REJECTED_BINDING_MISMATCH', 'ADMISSION_NOT_IMPLEMENTED']
