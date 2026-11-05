"""The one exception every refusal raises: the input was refused, so nothing was concluded."""


class Refused(Exception):
    pass
