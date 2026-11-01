"""Local HTTP authority validation shared by every route and app composition.

The launchers bind only IPv4 loopback. These checks mitigate browser DNS
rebinding; they do not authenticate other processes running on the host.
"""

ALLOWED_ORIGINS = frozenset({'http://127.0.0.1:5183', 'http://127.0.0.1:8765'})


def local_request_error(request):
    """Return a stable error code for an untrusted Host or Origin."""
    server = request.scope.get('server')
    if not server or len(server) != 2 or type(server[1]) is not int:
        return 'host_not_allowed'
    port = server[1]
    allowed_hosts = {f'127.0.0.1:{port}'}
    if port == 80:
        allowed_hosts.add('127.0.0.1')
    hosts = request.headers.getlist('host')
    if len(hosts) != 1 or hosts[0] not in allowed_hosts:
        return 'host_not_allowed'
    origins = request.headers.getlist('origin')
    if len(origins) > 1 or (origins and origins[0] not in ALLOWED_ORIGINS):
        return 'origin_not_allowed'
    return None
