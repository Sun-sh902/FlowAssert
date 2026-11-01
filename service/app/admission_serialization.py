"""Additive public admission fields; never expose receipt authentication material."""

from .admission_models import AdmissionEvaluation

LEGACY_ADMISSION = {
    'capture_status': 'CAPTURE_NOT_IMPLEMENTED',
    'admission_status': 'ADMISSION_NOT_IMPLEMENTED',
}

_CONTEXT_FIELDS = (
    'run_id', 'execution_cwd_sha256', 'source_basis_sha256',
    'rule_basis_sha256', 'started_mono_ns', 'completed_mono_ns',
    'verifier_work_completed', 'outer_exit_status', 'subprocess_failures',
)


def public_admission(status=None, context=None):
    """Project validated status and context without the bearer authentication token."""
    result = AdmissionEvaluation.model_validate(LEGACY_ADMISSION if status is None else status).model_dump()
    if context is not None:
        result['run_bound_metadata'] = {field: context[field] for field in _CONTEXT_FIELDS}
    return result


def public_live_run(run):
    # The fixture catalogue has no trusted run-bound execution receipt.
    return {**run, **public_admission()}


def legacy_history_response(data):
    """Remove the 3B extension from the frozen Phase 3A HTTP representation."""
    def strip(summary):
        return {k: v for k, v in summary.items()
                if k not in ('capture_status', 'admission_status', 'run_bound_metadata')}
    if 'items' in data:
        return {**data, 'items': [strip(item) for item in data['items']]}
    return strip(data)
