"""Solar position (NOAA) for the capture, and the shadow rule it makes possible.

The seam sidecar prints each frame's exposure timestamp, so the sun is not
assumed - it is computed for the time the pixels were taken.
"""
import math


def solar(y, mo, d, h, mi, lat, lon):
    if mo <= 2:
        y -= 1; mo += 12
    A = y // 100; Bc = 2 - A + A // 4
    J = int(365.25 * (y + 4716)) + int(30.6001 * (mo + 1)) + d + Bc - 1524.5 + (h + mi / 60) / 24
    T = (J - 2451545.0) / 36525
    L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360
    M = 357.52911 + T * (35999.05029 - 0.0001537 * T)
    e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T)
    Mr = math.radians(M)
    C = (math.sin(Mr) * (1.914602 - T * (0.004817 + 0.000014 * T))
         + math.sin(2 * Mr) * (0.019993 - 0.000101 * T) + math.sin(3 * Mr) * 0.000289)
    om = 125.04 - 1934.136 * T
    app = L0 + C - 0.00569 - 0.00478 * math.sin(math.radians(om))
    eps0 = 23 + (26 + ((21.448 - T * (46.815 + T * (0.00059 - T * 0.001813)))) / 60) / 60
    eps = eps0 + 0.00256 * math.cos(math.radians(om))
    dec = math.degrees(math.asin(math.sin(math.radians(eps)) * math.sin(math.radians(app))))
    yq = math.tan(math.radians(eps / 2)) ** 2
    L0r = math.radians(L0)
    Eq = 4 * math.degrees(yq * math.sin(2 * L0r) - 2 * e * math.sin(Mr)
                          + 4 * e * yq * math.sin(Mr) * math.cos(2 * L0r)
                          - 0.5 * yq * yq * math.sin(4 * L0r) - 1.25 * e * e * math.sin(2 * Mr))
    tst = (h * 60 + mi) + Eq + 4 * lon
    ha = tst / 4 - 180
    if ha < -180:
        ha += 360
    lar = math.radians(lat); dr = math.radians(dec); har = math.radians(ha)
    z = math.acos(math.sin(lar) * math.sin(dr) + math.cos(lar) * math.cos(dr) * math.cos(har))
    el = 90 - math.degrees(z)
    az = math.degrees(math.acos(max(-1, min(1, (math.sin(lar) * math.cos(z) - math.sin(dr))
                                            / (math.cos(lar) * math.sin(z))))))
    az = (180 + az) if ha > 0 else (180 - az)
    return el, az % 360
