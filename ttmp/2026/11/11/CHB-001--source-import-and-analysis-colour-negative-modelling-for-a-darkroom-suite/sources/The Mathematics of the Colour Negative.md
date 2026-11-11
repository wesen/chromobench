The Mathematics of the Colour Negative *an executable textbook*

**I**The mathematics

[1Spectra and density: the linear algebra of film](#ch-1)[2The forward model: film, paper and eye as composed functions](#ch-2)[3Inversion: from a scan back to dyes](#ch-3)[4Making it fast: from equations to real time](#ch-4)

Contents

**Short textbook** · four chapters of mathematics and algorithms

# The Mathematics of the Colour Negative

Four chapters on the algorithms behind reading, inverting and simulating colour film. A colour negative is read by projecting spectra onto a few channels, made by composing film, paper and eye, recovered by solving a small bounded least-squares problem at every pixel, and made usable by tabulating, batching and moving that work to the GPU. Each chapter derives the mathematics, computes every figure from it, explains the code of Chromogen, Chromogen Studio and spektrafilm that implements it, and ends with a small API and exercises. Two frames run through the book: a computed Portra 400 frame and a real Gold 200 scan.

chapters

4

numbered sections

36

computed figures

19

runnable sketches

16

words of prose

29k

Try it callouts

16

I

## The mathematics

From a spectrum to a density, through the forward model of film, paper and eye, back from a scan to dyes, and fast enough to use.

1

### Spectra and density: the linear algebra of film

Spectra as vectors: the 5 nm grid from 380 to 780 nm (81 samples) that spektrafilm and Chromogen use, a measurement as an inner product (a channel response is a sum over wavelength of light × transmittance × responsivity), and how coarse the grid can be before the quadrature error matters (compare 1, 5 and 10 nm on the running example).

Every program that reads, inverts or simulates a colour negative starts by turning spectra into numbers: 81 samples of light, transmittance and responsivity, multiplied and summed into three channel densities. Densities are additive at one wavelength, so a negative's spectral density is a linear function of its three dye amounts. A channel density is not: it is the logarithm of a weighted mean of transmittance, a soft minimum of the spectral density over the channel's band, and that one nonlinearity decides how well a 3×3 matrix can stand in for the film. On the running Portra 400 frame, the matrix that Chromogen and the long book build from each dye alone misses the grey card's cyan by 0.407 dye units through a white-LED camera and by 0.003 through narrowband LEDs; the Jacobian at zero dye, measured relative to the base, misses it by 0.003 through the camera as well, and its worst dye by 0.035. This chapter derives that matrix, says where it fails and by how much, shows why the dense highlights of a negative are its noisy parts, and runs the map in the other direction, from three numbers back to a spectrum. Afterwards you can compute any channel density from a spectrum, predict when linear inversion is safe, measure density noise without being fooled by outliers or by resampling, and explain what a spectral upsampling table stores.

## 1.1 Spectra as vectors on an 81-point grid

A **spectrum** is a function of wavelength, and every program in this book stores it as a vector. Chromogen's `spectrum.js` defines the grid as a frozen object, `new Grid(380, 780, 5)`, with n=(780−380)/5+1=81n = (780 - 380)/5 + 1 = 81 samples, and spektrafilm's `config.py` sets `SPECTRAL_SHAPE = colour.SpectralShape(380, 780, 5)`: the same 81 wavelengths. A `Spectrum` in Chromogen is a `Float64Array` of 81 values together with a **kind**: power, reflectance, transmittance, density or responsivity. The kind stops the two commonest errors of the subject where they are made: `mul` refuses a density ("densities add; multiply transmittances instead") and `add` refuses a transmittance ("transmittances multiply; add densities instead"), because a density is a logarithm and a transmittance is not. `toDensity` computes −log⁡10max⁡(T,10−8)-\\log\_{10}\\max(T, 10^{-8}), so a transmittance of zero reads as 8 D instead of infinity.

`units.js` does the same for scalars. A `Quantity` carries one of ten units; densities (`D`) and log exposures (`logH`) are separate vector spaces, and a **stop** converts into log exposure only, as log⁡102=0.30103\\log\_{10}2 = 0.30103 per stop. Adding a density to a log exposure throws, with the message "a density offset is not a log-exposure shift (Hunt 14.17)": a characteristic curve is the only map between the two.

**A measurement is an inner product.** A light E(λ)E(\\lambda) passes through film of transmittance T(λ)T(\\lambda) and reaches a sensor channel of sensitivity Qk(λ)Q_k(\\lambda). The channel's signal is

rk=∑i=181E(λi) T(λi) Qk(λi) Δλ=⟨T, Pk⟩ Δλ,Pk(λ)=E(λ) Qk(λ), r_k = \\sum\_{i=1}^{81} E(\\lambda_i)\\,T(\\lambda_i)\\,Q_k(\\lambda_i)\\,\\Delta\\lambda = \\bigl\\langle T,\\; P_k \\bigr\\rangle\\,\\Delta\\lambda, \\qquad P_k(\\lambda) = E(\\lambda)\\,Q_k(\\lambda),

where PkP_k, everything in the light path except the film, is the channel's **responsivity**. The signal is linear in the light and in the transmittance, and only the product E QkE\\,Q_k matters. Divide by the open-gate signal (no film, T=1T = 1) and the step Δλ\\Delta\\lambda cancels:

rkrkopen=∑iwki Ti,wki=Pk(λi)∑jPk(λj). \\frac{r_k}{r_k^{\\text{open}}} = \\sum_i w\_{ki}\\,T_i, \\qquad w\_{ki} = \\frac{P_k(\\lambda_i)}{\\sum_j P_k(\\lambda_j)} .

The weights wkiw\_{ki} are non-negative and sum to one, so the relative signal is a weighted mean of transmittance. Chromogen's `Channels` constructor normalises each responsivity this way when it is built, so every later formula can ignore Δλ\\Delta\\lambda and absolute power. For the running grey card through the narrowband green channel the weighted mean is 0.02895, a density of 1.538.

**How coarse can the grid be?** The sum is the rectangle rule for an integral, and because the responsivities fall to zero at both ends of the range it equals the trapezoid rule, whose error per interval is proportional to h2h^2 times the second derivative of the integrand. I recomputed the whole running example (exposure, development, spectral density and five channel families, for all six patches) on grids of 1, 5 and 10 nm. Light sources, Gaussian channels and sigmoid reflectances were evaluated on each grid; the tabulated data (Portra 400's dyes, base and sensitivities at 5 nm, Status M at 10 nm, the APD table at 2 nm) were interpolated as Chromogen interpolates them. With 1 nm as the reference, the largest differences over six patches and three channels are:

| channel family | 5 nm | 10 nm |
| --- | --- | --- |
| layer log exposure | 0.0011 | 0.0025 |
| narrowband LEDs × camera | 0.0022 | 0.0029 |
| white LED × camera | 0.0011 | 0.0013 |
| Status M | 0.0031 | 0.0100 |
| APD | 0.0055 | 0.0120 |
| printing density (Portra Endura) | 0.0188 | 0.0410 |

The 5 nm grid is good to a few thousandths of a density almost everywhere, and 10 nm is not. The outlier is the blue printing-density channel on the white patch (1.986 at 1 nm, 1.967 at 5 nm), where the paper's blue sensitivity falls by 0.58 in log10 over 5 nm at 485 nm just where the yellow dye's density is also changing fast; interpolating the sensitivity linearly instead of in log changes the error only to 0.018, so it is the steepness of the integrand and not the interpolation that costs. Status M's red product rises by 2.37 in log10 between 620 and 630 nm, which is why the grey card's Status M red density moves from 0.913 to 0.907 when the grid goes from 1 to 10 nm. The rule: the grid must resolve the steepest factor in the product, not the smoothest.

## 1.2 The Beer–Lambert–Bouguer law

At one wavelength, a thin slice dxdx of a non-scattering layer holding an absorber at concentration cc removes a fixed fraction of the light that reaches it, dI=−α(λ) c I dxdI = -\\alpha(\\lambda)\\,c\\,I\\,dx. Integrating through a layer of thickness ℓ\\ell gives I=I0 e−αcℓI = I_0\\,e^{-\\alpha c \\ell}, and the **density**, D=−log⁡10TD = -\\log\_{10} T, is

D(λ)=α(λ)ln⁡10 c ℓ=ε(λ) c ℓ. D(\\lambda) = \\frac{\\alpha(\\lambda)}{\\ln 10}\\,c\\,\\ell = \\varepsilon(\\lambda)\\,c\\,\\ell .

Density is proportional to the amount of absorber in the path (**proportionality**), and when several absorbers share the path, or sit in layers the light crosses in turn, transmittances multiply and densities add (**additivity**). A negative's **spectral density** is therefore

D(λ)=∑j∈{C,M,Y}cj εj(λ)+b(λ),T(λ)=10−D(λ), D(\\lambda) = \\sum\_{j \\in \\{C, M, Y\\}} c_j\\,\\varepsilon_j(\\lambda) + b(\\lambda), \\qquad T(\\lambda) = 10^{-D(\\lambda)},

where εj\\varepsilon_j is the **unit dye spectrum** of dye jj (the profile's spectral density of one unit of that dye), cjc_j is the **dye amount** in those units, and b(λ)b(\\lambda) is the **base**: support, mask and fog, everything that does not change with exposure. At one wavelength DD is a linear function of cc; across the grid it is the matrix–vector product D=Ec+bD = Ec + b with EE the 81×3 matrix of unit dye spectra, which `facts.py` computes in `spectral` as `(prof['dyes'] * c[None, :]).sum(1) + prof['base']`.

The grey card of the running example has c=(0.687,0.704,0.864)c = (0.687, 0.704, 0.864). At 550 nm its parts are cyan −0.0264-0.0264, magenta 0.8880.888, yellow 0.00220.0022 and base 0.60240.6024, which sum to 1.4662; their transmittances are 1.0626, 0.1294, 0.9950 and 0.2498, whose product, 0.03418, equals 10−1.466210^{-1.4662}. The cyan term is negative: Portra 400's unit dye spectra dip below zero, cyan to −0.039-0.039 at 555 nm, magenta to −0.034-0.034 at 455 nm and yellow to −0.033-0.033 at 530 nm. A real dye cannot have negative density; the profile's spectra are processed from datasheet measurements (its own metadata says so), and every program in this book uses them as they are. The dips are why a few entries of the narrowband KK in Section 1.4 are slightly negative.

The law has three conditions, and each is a way a real negative breaks it. The light must be of one wavelength; Section 1.3 shows what a band does. The layer must not scatter: silver grains scatter strongly, so a silver image's density depends on the geometry of the instrument, while dye images scatter little, and the ratio of specular to diffuse density (the Callier coefficient) reaches about 2 for silver but is usually no more than 1.1 for colour dye images (Hunt 18.4; James ch. 17). And the absorber must be uniform on the scale of the measurement. A layer whose dye sits in clumps transmits the area-mean of 10−D10^{-D}, not 10−mean D10^{-\\text{mean}\\,D}: a patch that is half at density 2.0 and half at 0.0 transmits (0.01+1)/2(0.01 + 1)/2 and reads 0.297, not 1.0; halves at 1.5 and 0.5 read 0.760; halves at 1.1 and 0.9 read 0.989. That is the same averaging of transmittance that Section 1.3 applies across wavelength, here applied across area, and it pulls the reading toward the clearest part in the same way.

**Try it.** Open [the Beer–Lambert sketch](#bench-01-spectra-and-density). It starts with the grey card's dye amounts through the white-LED camera. The additivity error (stack minus the sum of its parts) reads +0.096, +0.049 and +0.238. Set magenta to zero: blue turns sub-additive (−0.026). Switch to narrowband with the grey card's amounts: +0.001, +0.012, +0.001.

## 1.3 Channel density is a soft minimum

A **channel density** is the density a channel reads: the negative log of its relative signal,

Dk=−log⁡10∑iwki 10−Di, D_k = -\\log\_{10} \\sum_i w\_{ki}\\,10^{-D_i},

where Di=D(λi)D_i = D(\\lambda_i). This is `Channels.read` in `channels.js`, three lines long:

```js
// D: spectral density on the grid; P[k]: responsivity of channel k, normalised to sum 1
function read(P, D) {
  const T = D.map((d) => Math.pow(10, -d));
  return P.map((p) => -Math.log10(p.reduce((s, w, i) => s + w * T[i], 0)));
}
```

Three families of responsivity matter for negatives (Figure 1.1). **Status M** is the standard set of products for reading negatives (Hunt 14.15): Hunt's Table 14.1 lists each as log⁡10\\log\_{10} of the spectral product P=S⋅sP = S \\cdot s (source power times receiver response) at 10 nm steps, peak 5.000. Chromogen's `statusM()` interpolates the logarithms linearly onto the 5 nm grid and exponentiates, P=10v−5P = 10^{v - 5}, zero outside the tabulated range. **Printing density** is the density the print material sees: Giorgianni and Madden write the paper's red, green and blue exposures as sums over wavelength of printer-lamp power, negative transmittance and paper sensitivity (Giorgianni & Madden, Eq. 8.1), so PkP_k is lamp times paper sensitivity; `printing({ paper, lamp })` builds exactly that, and the facts file uses a 3,200 K lamp with Portra Endura's sensitivities. The Academy's APD is a printing density with standardised responsivities (SMPTE ST 2065-2, tabulated in Academy TB-2014-005, Annex A), tabulated from 368 to 728 nm at 2 nm with peaks at 692, 550 and 466 nm; `apd()` reads the table that the book's data folder ships, a byte-identical copy of `data/smpte_st_2065-2_apd_responsivities.txt`. **Scanner density** is the density a scanner or camera reads: Giorgianni and Madden write a scanner channel's effective responsivity as lamp × mirror × lens × filter × sensor (Giorgianni & Madden, Eq. B.4), and `scanner(sc)` multiplies a light by a camera channel, with one light per channel for a sequential capture such as three LEDs fired in turn. The facts file's two scanners are illustrative: narrowband LEDs at 660, 530 and 450 nm, or a white LED (a blue pump and a phosphor), behind the same generic Bayer camera. As weighted standard deviations their channels are 8 to 10 nm wide for the LEDs, 13 to 17 nm for Status M and 28 to 32 nm for the white LED.

**Figure 1.1.** Top left: Portra 400's unit dye spectra (cyan solid, magenta dashed, yellow dotted) and its base (grey), the spectral densities of one unit of each dye. Other panels: three channel families, each channel normalised to peak 1 (R solid, G dashed, B dotted), over the dyes as hairlines. The white-LED camera's red channel (red) peaks at 595 nm, between the magenta and cyan absorption peaks, where both dyes absorb. Computed from `data/book-data.json` (film data: spektrafilm, CC BY-SA 4.0).

**The soft minimum.** Write the channel density with natural logarithms:

Dk=−1ln⁡10 ln⁡∑iexp⁡ ⁣(ln⁡wki−ln⁡10⋅Di). D_k = -\\frac{1}{\\ln 10}\\,\\ln \\sum_i \\exp\\!\\bigl(\\ln w\_{ki} - \\ln 10 \\cdot D_i\\bigr).

The function ln⁡∑iexp⁡(zi)\\ln \\sum_i \\exp(z_i) is **log-sum-exp**, a smooth version of the maximum; with the sign flipped it is a smooth minimum. So a channel density is a weighted soft minimum of the spectral density over the channel's band, and two bounds follow. Since 10−x10^{-x} is convex, Jensen's inequality gives ∑iwki10−Di≥10−∑iwkiDi\\sum_i w\_{ki} 10^{-D_i} \\ge 10^{-\\sum_i w\_{ki} D_i}, hence Dk≤⟨D⟩kD_k \\le \\langle D \\rangle_k, the weighted mean. Since every term is at most the largest one, ∑iwki10−Di≤10−min⁡iDi\\sum_i w\_{ki} 10^{-D_i} \\le 10^{-\\min_i D_i} over the band, hence Dk≥min⁡DD_k \\ge \\min D. Keeping only the clearest wavelength i∗i^\* gives a third, Dk≤min⁡D−log⁡10wki∗D_k \\le \\min D - \\log\_{10} w\_{ki^\*}. With two wavelengths of equal weight at densities 0 and 2 the channel reads 0.297, close to the bound 0+log⁡102=0.3010 + \\log\_{10} 2 = 0.301.

On the running example the bounds hold for every patch and every family, and the gap between the weighted mean and the channel density reaches 0.162 D. Figure 1.2 shows the grey card through two red channels. Through the narrowband LED its spectral density is nearly flat across the band, and the channel reads 0.977 against a weighted mean of 0.981. Through the white-LED camera the band runs from 515 to 675 nm, the spectral density inside it falls from 1.56 at 515 nm to 0.70 at 605 nm and rises to 1.11 at 675 nm, and the channel reads 0.876 against a mean of 0.940: the transmitted light comes mostly from the trough near 600 nm, between the magenta and cyan peaks.

**Figure 1.2.** The grey card's spectral density (black) and two red channels: narrowband LED × camera (grey) and white LED × camera (red). Dotted: the channel weight ww; dashed: the transmitted-light weight w⋅10−Dw \\cdot 10^{-D}, renormalised, which is the weighting of the derivatives below. Thick horizontal lines: channel density; thin: weighted mean of DD. The steps at 400 and 700 nm are the edges of the profile's base data, and the drop at 750 nm the edge of its cyan data (Section 1.6). Computed from `data/book-data.json` (film data: spektrafilm, CC BY-SA 4.0).

**Derivatives.** Differentiate DkD_k with respect to one dye amount. The chain rule through the logarithm and the exponential gives

∂Dk∂cj=∑iwki 10−Di εj(λi)∑iwki 10−Di=⟨εj⟩w\~k,w\~ki=wki 10−Di∑lwkl 10−Dl. \\frac{\\partial D_k}{\\partial c_j} = \\frac{\\sum_i w\_{ki}\\,10^{-D_i}\\,\\varepsilon_j(\\lambda_i)}{\\sum_i w\_{ki}\\,10^{-D_i}} = \\bigl\\langle \\varepsilon_j \\bigr\\rangle\_{\\tilde w_k}, \\qquad \\tilde w\_{ki} = \\frac{w\_{ki}\\,10^{-D_i}}{\\sum_l w\_{kl}\\,10^{-D_l}} .

The slope is the mean of the unit dye spectrum under the **transmitted-light weight** w\~k\\tilde w_k, the dashed curves of Figure 1.2. Adding dye moves that weight toward the wavelengths where the film stays clear: for the white-LED red channel on the grey card the weight's centroid moves from 594.0 to 602.9 nm. Differentiating once more,

∂2Dk∂cj ∂cl=−ln⁡10⋅Cov⁡w\~k(εj,εl), \\frac{\\partial^2 D_k}{\\partial c_j\\,\\partial c_l} = -\\ln 10 \\cdot \\operatorname{Cov}\_{\\tilde w_k}\\bigl(\\varepsilon_j, \\varepsilon_l\\bigr),

minus ln⁡10\\ln 10 times the covariance of the two dye spectra under the transmitted-light weight. A covariance matrix is positive semidefinite (every variance is non-negative), so the Hessian is negative semidefinite and DkD_k is a **concave** function of the dye amounts: along any straight line through dye space it bends downward or not at all. For the white-LED red channel at the grey card the formula gives a Hessian whose eigenvalues are −0.364-0.364, −0.024-0.024 and −0.0001-0.0001, and a finite-difference Hessian agrees to four decimals.

Concavity gives the sign of the two classic failures. Along one dye the second derivative is −ln⁡10 Var⁡(εj)-\\ln 10\\,\\operatorname{Var}(\\varepsilon_j), never positive, so doubling a dye less than doubles its channel density: proportionality fails downward. Between two dyes the off-diagonal term has the sign opposite to their covariance, and to second order the additivity error of amounts cjc_j and clc_l is cjclc_j c_l times it. Cyan and magenta absorb opposite halves of the white-LED red band, their covariance is negative, the cross term is +0.170+0.170, and the stack reads denser than the sum of its parts: additivity fails upward. The long book measures both failures on the same dyes through a 100 nm channel (*Colour Negatives from First Principles*, Section 2.5).

## 1.4 The 3×3 matrix K is a Jacobian

Three channel densities and three dye amounts suggest a linear system. Expand DkD_k about a reference point c0c^0 to first order:

Dk(c)≈Dk(c0)+∑jKkj (cj−cj0),Kkj=∂Dk∂cj∣c0. D_k(c) \\approx D_k(c^0) + \\sum_j K\_{kj}\\,(c_j - c^0_j), \\qquad K\_{kj} = \\frac{\\partial D_k}{\\partial c_j}\\Bigr\\rvert\_{c^0} .

The matrix KK is the **Jacobian**: the matrix of first partial derivatives, here 3×3. At zero dye and no base, 10−D=110^{-D} = 1 everywhere, the transmitted-light weight is the channel weight itself, and

Kkj=∑iwki εj(λi)=⟨εj⟩wk: K\_{kj} = \\sum_i w\_{ki}\\,\\varepsilon_j(\\lambda_i) = \\bigl\\langle \\varepsilon_j \\bigr\\rangle\_{w_k}:

the plain weighted mean of each unit dye spectrum over each channel. In the narrowband limit the weight collapses onto one wavelength and Kkj→εj(λk)K\_{kj} \\to \\varepsilon_j(\\lambda_k), Hunt's spectral densities (Hunt 14.19). The narrowband channels of the running example come close: their centroids are 656.5, 530.4 and 450.8 nm, the dyes at the nearest grid points have diagonal densities 1.129, 1.289 and 1.180, and the Jacobian has 1.142, 1.239 and 1.149.

Hunt builds the same matrix another way. His **analytical densities** (Hunt 14.20) come from the linear system I=Kc+sI = Kc + s, where the constants of KK are found from "a sample of each dye on its own", and ss from an area free of image dye. Chromogen implements that construction literally: `analytical(dyes)` returns, for each channel, the channel density of each unit dye spectrum read alone, `this.read(e)[k]`, with no base, and `facts.py` does the same in `linear_dyes`. That matrix is a secant, the slope of the chord from zero to one unit of each dye, not the tangent at zero. By concavity the chord lies below the tangent along each axis, so the secant's diagonal is smaller. Through the narrowband LEDs the difference is small (diagonals 1.131, 1.222, 1.146 for the secant); through the white-LED camera it is large:

Ksecant=(0.2530.3300.0130.0360.7490.0320.0070.1180.592),Ktangent=(0.3600.4760.0130.0550.9500.0580.0070.2430.837). K\_{\\text{secant}} = \\begin{pmatrix} 0.253 & 0.330 & 0.013 \\\\ 0.036 & 0.749 & 0.032 \\\\ 0.007 & 0.118 & 0.592 \\end{pmatrix}, \\qquad K\_{\\text{tangent}} = \\begin{pmatrix} 0.360 & 0.476 & 0.013 \\\\ 0.055 & 0.950 & 0.058 \\\\ 0.007 & 0.243 & 0.837 \\end{pmatrix}.

A unit of cyan alone reads only 0.253 through the white-LED red channel, because the channel's band extends to 515 nm, where cyan is nearly clear, and the soft minimum lets that light through. In a grey, the magenta closes that window, and the cyan's effective slope is the tangent's 0.360 or more. Solving with the secant on the grey card therefore overestimates the cyan amount: the facts file records the error as (0.407, 0.093, 0.459). Solving with the tangent at zero gives (0.006, −0.083, 0.006), and Section 1.6 removes most of what remains.

**Solving and conditioning.** `linalg.js` holds the small linear algebra this needs. `inv3` inverts a 3×3 matrix by cofactors (the transposed matrix of signed 2×2 minors divided by the determinant) and throws "singular 3×3" when the determinant is below 10−30010^{-300}; `solve3(A, b)` multiplies by that inverse. For three unknowns this closed form needs no pivoting; K K−1K\\,K^{-1} differs from the identity by 1.1×10−161.1 \\times 10^{-16} for the white-LED matrix. How much the solve amplifies an error in the measured densities is set by the **singular values** of KK, the square roots of the eigenvalues of K⊤KK^\\top K: the ratio of the largest to the smallest, the **condition number**, bounds the relative amplification. `minSingular(A)` computes the smallest singular value by Jacobi rotations: it forms M=A⊤AM = A^\\top A, repeatedly picks the largest off-diagonal entry MpqM\_{pq}, rotates rows and columns p,qp, q by the angle θ=12atan2⁡(2Mpq,Mqq−Mpp)\\theta = \\tfrac12 \\operatorname{atan2}(2M\_{pq}, M\_{qq} - M\_{pp}) that zeroes it, and stops after 30 rotations or when every off-diagonal entry is below 10−1510^{-15}; the diagonal is then the eigenvalues. The narrowband secant KK has singular values 1.226, 1.144 and 1.130 (condition number 1.09), Status M 1.11, the white-LED camera 0.853, 0.571 and 0.213 (condition number 4.00). The smallest belongs almost entirely to cyan (its right singular vector is (−0.98, 0.18, −0.03) in dye space): a unit of cyan moves the three channel densities by only 0.213 in all, so a density error of 0.01 in the matching direction becomes 0.047 of cyan, four times the amplification of the best-determined direction, which is mostly magenta. The third function, `lm`, a bounded Levenberg–Marquardt solver for three unknowns, solves the full nonlinear equation instead of its linearisation; started from the linear answer it recovers the grey card's dye amounts to four decimals in three iterations (measured in node). [Chapter 3](#ch-3) derives it.

## 1.5 Where linearity breaks

A second-order expansion says how fast the linear model goes wrong. For a single dye jj through channel kk, from zero dye, the Taylor series to second order is Dk(c)≈c m−ln⁡102 c2s2D_k(c) \\approx c\\,m - \\tfrac{\\ln 10}{2}\\,c^2 s^2, where mm and s2s^2 are the mean and variance of εj\\varepsilon_j under the channel weight. The relative shortfall of the true density below the linear prediction Dlin=cmD\_{\\text{lin}} = cm is therefore

Dlin−DkDlin≈ln⁡102 Dlin CV2,CV=sm, \\frac{D\_{\\text{lin}} - D_k}{D\_{\\text{lin}}} \\approx \\frac{\\ln 10}{2}\\; D\_{\\text{lin}} \\; \\mathrm{CV}^2, \\qquad \\mathrm{CV} = \\frac{s}{m},

so the error grows in proportion to the density and to the square of the dye's **coefficient of variation** across the band. Where the dye's slope dominates the band, the variance grows with the square of the band's width; centred on a dye's peak, where its curvature dominates, with the fourth power. On Portra 400's magenta through a Gaussian channel at its 540 nm peak, at one unit:

| channel FWHM | linear density | true density | shortfall | rule |
| --- | --- | --- | --- | --- |
| 10 nm | 1.322 | 1.322 | 0.0002 | 0.0002 |
| 20 nm | 1.292 | 1.288 | 0.0031 | 0.0028 |
| 40 nm | 1.188 | 1.140 | 0.041 | 0.031 |
| 80 nm | 0.926 | 0.720 | 0.222 | 0.190 |
| 120 nm | 0.717 | 0.472 | 0.342 | 0.366 |

From 10 to 20 to 40 nm the shortfall grows about fifteen times per doubling. The rule is accurate while the shortfall is below a few per cent and then only indicates the size. A narrowband LED of 20 nm keeps magenta linear to 0.3 % at one unit and 0.7 % at two; a 40 nm band costs 4 % and 11 %; at 80 nm, close to the white-LED camera's channels, it is 22 % at one unit.

Yet the white-LED camera on the grey card was nearly linear in Section 1.4 once the right slope was used. The reason is the direction of travel. Along a direction uu in dye space the second derivative is −ln⁡10⋅Var⁡w\~(∑jujεj)-\\ln 10 \\cdot \\operatorname{Var}\_{\\tilde w}\\bigl(\\sum_j u_j \\varepsilon_j\\bigr): the variance across the band of the spectral density that the step adds. A step of cyan alone adds a sloped spectrum, and the curvature of the white-LED red channel at the grey card along it is −0.193-0.193; along cyan minus magenta it is −0.364-0.364. A step along the grey card's own dye mixture adds the spectral density of a darker grey, which is flat across the band because the dye set is designed to make neutrals, and the curvature is −0.0125-0.0125, fifteen times smaller. Linearity is a property of the spectral density increment across the band, not of the band's width alone; broadband channels are nearly linear along the grey scale and far from it in saturated colours.

Figure 1.3 measures the whole grey scale. Each point is a neutral exposure from log⁡H=−2.0\\log H = -2.0 to +2.6+2.6 (the grey card is 0), developed through Portra 400's curves, read through each family, and solved with c=K−1(Dk−Dkrebate)c = K^{-1}(D_k - D_k^{\\text{rebate}}). With the code's secant KK, the narrowband and Status M errors grow to 0.027 and 0.037 dye units at the dense end, and the white-LED error to 1.15. With the Jacobian at zero dye taken relative to the base (Section 1.6), all three errors start at zero and grow with density: 0.003, 0.010 and 0.036 at the grey card, and 0.028, 0.074 and 0.184 at the densest step. For Status M the secant does better at high density because a chord to one unit is a better average slope over that range than the tangent at zero; for the white-LED camera the base-weighted tangent is better everywhere.

**Figure 1.3.** Worst error over the three dyes of the 3×3 linear solve along the running example's grey scale, against the grey's Status M green density above the rebate, for narrowband LEDs (solid), Status M (dashed) and the white-LED camera (red, dotted). Left: KK from each unit dye alone with no base, as `Channels.analytical` and `facts.py` build it. Right: KK = Jacobian at zero dye with the base-weighted responsivity of Section 1.6. Vertical lines mark the grey card and the white patch. Log scale (film data: spektrafilm, CC BY-SA 4.0).

**Try it.** Open [the linearity sketch](#bench-01-spectra-and-density). It starts with magenta through a 40 nm channel at its 540 nm peak, 10.6 % below the tangent at two units. Narrow the band to 20 nm (0.7 %), widen it to 80 nm (41.9 %), then switch the step to the neutral mixture: 6.0 % at 80 nm.

**Exercise.** For the white-LED camera at the grey card, compute the Jacobian KgreyK\_{\\text{grey}} by finite differences of `read`. Use c=c0+Kgrey−1(D−D(c0))c = c^0 + K\_{\\text{grey}}^{-1}\\bigl(D - D(c^0)\\bigr) to solve the six patches from the grey card. Which patch has the largest error, and in which direction does it lie?

## 1.6 Base and rebate: coordinates relative to clear film

A negative has a **base**: support, orange mask and fog, present everywhere. Its unexposed processed edge, the **rebate**, shows the base alone, and every inversion measures the rebate and works relative to it. The question is what "relative to" means for a channel density.

At one wavelength it means subtraction, because the base is one more additive term in D(λ)D(\\lambda). Through a channel the base multiplies the transmittance before the weighted mean is taken:

Dk(c;b)−Dk(0;b)=−log⁡10∑iwki 10−bi 10−(Ec)i∑iwki 10−bi=−log⁡10∑iwki(b) 10−(Ec)i,wki(b)=wki 10−bi∑lwkl 10−bl. D_k(c; b) - D_k(0; b) = -\\log\_{10} \\frac{\\sum_i w\_{ki}\\,10^{-b_i}\\,10^{-(Ec)\_i}}{\\sum_i w\_{ki}\\,10^{-b_i}} = -\\log\_{10} \\sum_i w^{(b)}\_{ki}\\,10^{-(Ec)\_i}, \\qquad w^{(b)}\_{ki} = \\frac{w\_{ki}\\,10^{-b_i}}{\\sum_l w\_{kl}\\,10^{-b_l}} .

Subtracting the rebate's channel density is exactly the channel density of the dyes alone, read through a different channel: one whose responsivity is the original multiplied by the base's transmittance. In density terms the subtraction is a division of transmittances, Tk/TkrebateT_k / T_k^{\\text{rebate}}, and that is how the Studio writes it: `sigmaD` and `classify` in `source.js` compute −log⁡10(T/Treb)-\\log\_{10}(T / T\_{\\text{reb}}) per channel. The identity is exact for any channel; numerically, for the white-LED camera and the grey card, the two sides agree to 3×10−163 \\times 10^{-16}.

What is not exact is to treat the result as if it were the dyes read through the original channel. Through narrowband LEDs the base is nearly constant across each band, w(b)≈ww^{(b)} \\approx w, and on the grey card the difference between "grey minus rebate" and "dyes alone" is at most 0.004. Through Status M it is 0.010, through APD 0.011, and through the white-LED camera 0.052: there, grey minus rebate is (0.556, 0.679, 0.884) and the dyes alone read (0.576, 0.731, 0.890). The base is darkest from 400 to 550 nm (0.60 to 0.82) and only 0.19 to 0.24 from 600 to 700 nm, so it reweights each broad channel toward its long-wavelength side.

The repair follows from the identity: build KK through the base-weighted responsivity, as the Jacobian at zero dye of Dk(c;b)−Dk(0;b)D_k(c; b) - D_k(0; b). That is the right-hand panel of Figure 1.3. On the grey card through the white-LED camera the four ways of building KK give errors of:

| how KK is built | error in (cC,cM,cY)(c_C, c_M, c_Y) |
| --- | --- |
| each unit dye alone, no base (Chromogen, `facts.py`) | (0.407, 0.093, 0.459) |
| each unit dye on top of the base, rebate subtracted | (0.225, 0.198, 0.503) |
| Jacobian at zero dye, no base | (0.006, −0.083, 0.006) |
| Jacobian at zero dye, base-weighted | (−0.003, −0.035, 0.000) |

Two lessons come out of the table. The chord of the dye-alone construction is the main error, and adding the base to the chord does not fix it, because the chord is still taken through a window that a real grey would close. The slope at the operating point is what a linear model needs, and of the matrices that can be built before any picture is seen, the base-weighted Jacobian at zero dye is the one closest to that slope.

**A gap in the data.** Portra 400's profile has no base density below 400 nm or above 700 nm (the values are missing and the book's data stores them as zero), and no cyan density above 745 nm. A channel that reaches past 700 nm sees clear base there. The narrowband, white-LED and Status M channels hardly do (Status M red puts 0.4 % of its weight there), but 16 % of the APD red channel's weight and 37 % of the printing-density red channel's weight lie outside 400–700 nm. Extending the base flat from its last measured value (an assumption made only for this comparison) raises the rebate's red density from 0.170 to 0.214 in APD and from 0.143 to 0.242 in printing density; the facts file's 0.143 is an artefact of the gap.

## 1.7 Noise in the density domain

A scanner measures transmittance with noise. If the measured value is T+nT + n with nn of standard deviation σT\\sigma_T, small compared with TT, then a first-order expansion of D=−log⁡10TD = -\\log\_{10} T gives

σD≈∣dDdT∣σT=σTTln⁡10=0.434 σTT, \\sigma_D \\approx \\left\\lvert \\frac{dD}{dT} \\right\\rvert \\sigma_T = \\frac{\\sigma_T}{T \\ln 10} = 0.434\\,\\frac{\\sigma_T}{T},

the relation Dainty and Shaw state for small fluctuations, with log⁡10e=0.434\\log\_{10} e = 0.434 (Dainty & Shaw, ch. 8, p. 283). For a fixed σT\\sigma_T it grows as 1/T1/T: one more unit of density means ten times the noise. The dense parts of a negative are the scene's highlights, so the highlights are the noisy part of a scan. A sensor whose noise is dominated by photon counting has σT∝T\\sigma_T \\propto \\sqrt{T}, and then σD∝1/T\\sigma_D \\propto 1/\\sqrt{T}: slower growth, same direction.

The expansion is first order. The second-order term adds a bias to the mean density, σT2/(2T2ln⁡10)\\sigma_T^2/(2T^2 \\ln 10), which is 9×10−59 \\times 10^{-5} at T=0.1T = 0.1 with σT=0.002\\sigma_T = 0.002 but 0.00870.0087 at T=0.01T = 0.01. Dainty and Shaw cite Trabka's check that at T=0.1T = 0.1 a relative fluctuation of 0.3 makes the linear relation about 3 % wrong. In Figure 1.4's simulation the sample standard deviation of clean samples follows the law to within 2 % up to D=1.6D = 1.6 (σT/T=0.08\\sigma_T / T = 0.08) and departs above it, reaching 0.19 against a predicted 0.14 at D=2.2D = 2.2.

**Estimating σ in the presence of outliers.** Dust, scratches and hot pixels put a few samples far from the rest, and the sample standard deviation follows them. The **median absolute deviation** (MAD), median⁡i∣xi−median⁡(x)∣\\operatorname{median}\_i \\lvert x_i - \\operatorname{median}(x) \\rvert, does not: up to half the samples can be arbitrary before it moves without bound. For Gaussian data the MAD estimates Φ−1(3/4) σ=0.6745 σ\\Phi^{-1}(3/4)\\,\\sigma = 0.6745\\,\\sigma, where Φ\\Phi is the standard normal distribution function, so

σ^=1.4826⋅median⁡i∣xi−median⁡(x)∣ \\hat\\sigma = 1.4826 \\cdot \\operatorname{median}\_i \\lvert x_i - \\operatorname{median}(x) \\rvert

is consistent for σ\\sigma: it converges to σ\\sigma as the sample grows. The price is efficiency: on 81 Gaussian samples the variance of σ^\\hat\\sigma is 2.7 times that of the standard deviation (an efficiency of 0.37), measured over 20,000 trials. One sample at 50σ among 81 moves the standard deviation from 1.08 to 5.62 and the MAD estimate from 1.10 to 1.12.

**Figure 1.4.** Density noise against density for transmittance noise σT=0.002\\sigma_T = 0.002 of the clear-film signal (illustrative). Each point: 4,000 samples T+nT + n, with 5 % of them replaced by dust outliers T⋅U(0.3,0.8)T \\cdot U(0.3, 0.8). Line: the first-order law σT/(Tln⁡10)\\sigma_T / (T \\ln 10). Filled: 1.4826⋅1.4826 \\cdot MAD with outliers; open: standard deviation with outliers; small red: standard deviation without outliers. The MAD stays within 10 % of the law up to D=2.6D = 2.6 (the outliers bias it up a little); the standard deviation sits near 0.07 wherever the outliers dominate.

**How the Studio measures σ.** The Studio's base map needs each channel's density noise to decide whether a layer reads at base within noise (`classify`, with a threshold of 3σ). `sigmaD(data, w, h, Treb)` in `source.js` computes it per channel:

```js
// sigma of density for one channel: MAD of each pixel's departure from the mean of its (2R+1)² neighbours
function sigmaD(D, w, h, R = 4) {
  const dev = [];
  for (let y = R; y < h - R; y++) for (let x = R; x < w - R; x++) {
    let s = 0, n = 0;
    for (let v = -R; v <= R; v++) for (let u = -R; u <= R; u++) if (u || v) { s += D[(y + v) * w + x + u]; n++; }
    dev.push(Math.abs(D[y * w + x] - s / n));
  }
  dev.sort((a, b) => a - b);
  return 1.4826 * dev[dev.length >> 1];
}
```

The listing is the definition; the Studio computes the box sums with summed-area tables (running-sum images from which any box sum takes four lookups), counts the neighbours each box holds at borders and masked pixels, skips boxes with fewer than 9, and returns `null` below 60 departures. Two choices in it need a reason.

The departure is taken from the mean of the 80 neighbours, leaving the pixel itself out. For white noise of standard deviation σ\\sigma the departure then has variance σ2(1+1/80)\\sigma^2(1 + 1/80), so the estimate is high by 81/80=1.0062\\sqrt{81/80} = 1.0062: measured 1.0063 on a 2048×2048 simulation. A local mean also absorbs smooth gradients, such as uneven light across the rebate, that a global median would count as noise.

The departure is not a difference of neighbours. The obvious alternative, ∣xi+1−xi∣\\lvert x\_{i+1} - x_i \\rvert divided by 2\\sqrt 2, assumes neighbouring pixels are independent. In the Studio they often are not: `region()` reduces a scan to the working size (at most 2,048 pixels) and the global size (at most 640) by averaging each output pixel's footprint of source pixels, from `floor(xa)` to `ceil(xb)`. When the reduction factor is not an integer, neighbouring footprints share a column or a row, neighbouring outputs share noise, and their difference is smaller than independence predicts. I simulated white noise on a 2048-pixel square and reduced it the way `region()` does:

| reduction | footprint (source px) | neighbour differences | 9×9 local mean |
| --- | --- | --- | --- |
| 1.000 | 1.00 | 1.000 | 1.006 |
| 0.700 | 1.43 | 0.754 | 0.966 |
| 0.500 | 2.00 | 0.999 | 1.005 |
| 0.439 | 2.28 | 0.827 | 0.986 |
| 0.3125 (2048 → 640) | 3.20 | 0.876 | 0.994 |

Each entry is the estimate divided by the true per-pixel standard deviation of the reduced image. Neighbour differences read 25 % low at a factor of 0.7 and exact at 0.5, where footprints do not overlap; the local mean stays within 4 %. Noise correlated over two pixels (a 2×2 box blur, standing in for demosaicing) does the same: neighbour differences read 0.706 of the truth and the local mean 0.983. On the Gold 200 frame's rebate box (98, 100, 20, 680), whose transmittances are (0.121, 0.679, 0.214) in the sample's count units, the local-mean estimate is (0.0088, 0.0068, 0.0122) D for red, green and blue, and neighbour differences read 6 to 11 % lower. By the law above, that is relative transmittance noise of 2.0, 1.6 and 2.8 %; every 0.30 D above the rebate doubles the density noise if the noise is fixed in transmittance, and multiplies it by 1.41 if it is photon noise.

**Try it.** Open [the density-noise sketch](#bench-01-spectra-and-density). At D=1D = 1 with 5 % outliers the law gives 0.0087, the MAD 0.0092 and the standard deviation 0.065. Set the outliers to zero and the two agree; raise DD to 2.2 and both leave the first-order line.

## 1.8 The other direction: spectral upsampling

A simulator such as spektrafilm starts from an RGB image and must expose film with a spectrum, because film layers integrate light against their own sensitivities. Going from three numbers to 81 is **spectral upsampling**, and it is an ill-posed inverse problem: 81 unknowns, 3 equations. The CIE colour-matching functions xˉ,yˉ,zˉ\\bar x, \\bar y, \\bar z are the three responsivities that define XYZ ([Chapter 2](#ch-2)); write the measurement as X=A⊤RX = A^\\top R, where the columns of the 81×3 matrix AA are the light times those functions. Any pp with A⊤p=0A^\\top p = 0 (the **null space** of A⊤A^\\top) can be added to a reflectance RR without changing its colour; such a pp is a **metameric black**, and RR and R+pR + p are **metamers**. Projecting any perturbation onto that null space gives one:

pblack=p−A (A⊤A)−1A⊤p. p\_{\\text{black}} = p - A\\,(A^\\top A)^{-1} A^\\top p .

On the running example's skin patch I added a sine of amplitude 0.08 and period 200 nm, projected this way. Its XYZ under the scene light is unchanged to four decimals, but Portra 400's layer log exposures change by (0.017, 0.009, 0.040), the blue layer by 0.13 stop. An upsampler must pick one spectrum out of an infinite set, and the choice changes what the simulated film records.

**Jakob and Hanika's sigmoid.** Jakob and Hanika restrict the choice to a three-parameter family that is smooth and physically bounded (Jakob & Hanika 2019, Eqs. 2–3):

R(λ)=S(c0λ2+c1λ+c2),S(x)=12+x21+x2. R(\\lambda) = S\\bigl(c_0 \\lambda^2 + c_1 \\lambda + c_2\\bigr), \\qquad S(x) = \\frac12 + \\frac{x}{2\\sqrt{1 + x^2}} .

The quadratic gives one peak (a green), one trough (a purple) or a slope (a red or a blue); the sigmoid maps any real number into (0,1)(0, 1), so no coefficients produce a reflectance outside \[0,1\]\[0, 1\]. It needs no exponential: their Algorithm 1 takes six floating-point operations per wavelength. Three coefficients for three equations make the fit square, but Jakob and Hanika note that very bright saturated and very dark colours can have several solutions, so they fill their table by continuation from moderate brightness, starting each fit from its neighbour's answer. Chromogen's `sigmoid([c0, c1, c2])` evaluates the family on u=(λ−380)/400u = (\\lambda - 380)/400, as `facts.py` does, and `facts.py`'s `fit_patch` finds each coloured patch's coefficients with Levenberg–Marquardt from a start of zero, matching the patch's XYZ under the scene light. The greys need no fit: a flat reflectance rr is c0=c1=0c_0 = c_1 = 0 and c2=S−1(r)=(2r−1)/(2r(1−r))c_2 = S^{-1}(r) = (2r - 1)/(2\\sqrt{r(1-r)}), which is −0.816-0.816 for the 18.4 % card. Figure 1.5 shows the six patches.

**Figure 1.5.** The six running-example patches as Jakob–Hanika spectra, with their coefficients on u=(λ−380 nm)/400 nmu = (\\lambda - 380\\,\\mathrm{nm})/400\\,\\mathrm{nm}. The greys are flat (c0=c1=0c_0 = c_1 = 0); foliage (red) is the only patch with c0\<0c_0 \< 0, a single peak at 550 nm; skin rises toward the red and sky toward the blue. Coefficients from `facts.py`'s fits; the curves reproduce `data/book-data.json`'s patch spectra to 2×10−42 \\times 10^{-4}.

**Tables make it fast.** Fitting is an optimisation per colour, too slow per pixel, so the fits are tabulated. Jakob and Hanika store three 64×64×64 cubes of coefficients, one per largest RGB component, 9 MiB in all, indexed by the two normalised smaller components and the brightness; their reason for the third dimension is that a 2D table at full brightness maps dark colours to needlessly peaked spectra (Jakob & Hanika, Sect. 3.1 and Fig. 4). spektrafilm's `hanatos2025` method is a different table, provided by hanatos (Johannes Hanika, the paper's second author, whose vkdt the README links), and it is a lookup table, not a published method. Its coefficient file `hanatos_irradiance_xy_coeffs_250304.lut` is a 16-byte header, a 512×512 grid of four float32 values, and a text trailer that documents it: sigmoid spectra for emission, indexed by xy chromaticity, with the fourth value the brightness X+Y+ZX + Y + Z of the spectrum. Emission is the reason a 2D table suffices: an irradiance spectrum is not bounded by 1, so brightness is a plain scale factor and only chromaticity needs a table.

The code runs in three stages. `_tri2quad` maps a chromaticity (x,y)(x, y) in the triangle x,y≥0x, y \\ge 0, x+y≤1x + y \\le 1 onto the unit square by ( (1−x)2, y/(1−x) )(\\,(1 - x)^2,\\; y/(1 - x)\\,); `_quad2tri` inverts it, and the round trip is exact to 6×10−176 \\times 10^{-17}. `compute_lut_spectra` interpolates the coefficients cubically at each node of a square grid, evaluates S(c0λ2+c1λ+c2)/bS(c_0\\lambda^2 + c_1\\lambda + c_2)/b in raw nanometres on a 1 nm grid from 360 to 800 nm (the source comment says 0.5 nm; `np.linspace(360, 800, 441)` is 1 nm), blurs it with a Gaussian of 5 nm and resamples to the 81-point grid. The shipped table `irradiance_xy_tc.npy` is that computation on a 192×192 grid stored as float16: I recomputed 400 random nodes from the coefficient file and matched it to a relative 4.8×10−44.8 \\times 10^{-4}, within float16's step of 9.8×10−49.8 \\times 10^{-4}. Its spectra have nearly constant X+Y+ZX + Y + Z (median 21.43, 5–95 % range 21.16 to 22.38 with the book's colour-matching fit), so a pixel's brightness is a scale factor. Finally `compute_hanatos2025_tc_lut` contracts the spectra with the film's sensitivities once, rawxy,k=∑ispectrumxy,i Sk(λi)\\text{raw}\_{xy,k} = \\sum_i \\text{spectrum}\_{xy,i}\\,S_k(\\lambda_i), into a 192×192×3 table of layer exposures, and `rgb_to_raw_hanatos2025` does per pixel only this: RGB to XYZ, chromaticity and brightness bb, one cubic lookup in the 2D table, multiply by bb. The 81-term inner products of Section 1.1 happen once per film, not once per pixel, and because exposure is linear in the spectrum the result is exact up to the table's interpolation error ([Chapter 4](#ch-4) measures what such tables cost and save). Its metamers are close to the running example's: at each coloured patch's chromaticity, scaled to the same luminance, the table's spectrum changes Portra 400's log exposures by at most 0.013 against the patch's reflected light.

**Mallett and Yuksel's three primaries.** The other upsampler in the module, `rgb_to_raw_mallett2019`, is linear. Mallett and Yuksel precompute three spectra Sr,Sg,SbS_r, S_g, S_b for the sRGB primaries, chosen so that each reproduces its primary under D65 and so that they form a partition of unity, Sr+Sg+Sb=1S_r + S_g + S_b = 1 at every wavelength (Mallett & Yuksel 2019, Eqs. 7–8). A linear-sRGB triple (r,g,b)(r, g, b) then becomes R=rSr+gSg+bSbR = r S_r + g S_g + b S_b. At each wavelength that is a convex combination of rr, gg and bb with weights Sr(λ),Sg(λ),Sb(λ)S_r(\\lambda), S_g(\\lambda), S_b(\\lambda), so min⁡(r,g,b)≤R(λ)≤max⁡(r,g,b)\\min(r, g, b) \\le R(\\lambda) \\le \\max(r, g, b): any triple in \[0,1\]3\[0, 1\]^3 gives a valid reflectance, white gives exactly 1 and black exactly 0. spektrafilm multiplies the basis by the film's reference illuminant (D55 for Portra 400, where the basis was built for D65), contracts it with the sensitivities, and divides by the green response of a 0.184 grey, so mid-grey exposes the green layer at 1.

**The band-pass window and the surface.** Before the contraction, `compute_hanatos2025_tc_lut` can multiply the sensitivities by a band-pass window and the result by a correction surface, both stored per film in the profile. The `erf4` window is the product of two error-function edges, 12(1+erf⁡λ−cuvσuv2)⋅12(1−erf⁡λ−cirσir2)\\tfrac12\\bigl(1 + \\operatorname{erf}\\frac{\\lambda - c\_{uv}}{\\sigma\_{uv}\\sqrt2}\\bigr) \\cdot \\tfrac12\\bigl(1 - \\operatorname{erf}\\frac{\\lambda - c\_{ir}}{\\sigma\_{ir}\\sqrt2}\\bigr); Portra 400's parameters are cuv=433.5c\_{uv} = 433.5, σuv=31.6\\sigma\_{uv} = 31.6, cir=593.1c\_{ir} = 593.1, σir=68.8\\sigma\_{ir} = 68.8 nm, so the window is 0.90 at 500 nm and 0.06 at 700 nm. Each windowed sensitivity is divided by nk=∑SkWEref/∑SkErefn_k = \\sum S_k W E\_{\\text{ref}} / \\sum S_k E\_{\\text{ref}}, so every layer's response to the reference illuminant is unchanged: the window reshapes each layer within its band and keeps white balance. Under the running example's 5,500 K light the normalisers are (0.336, 0.739, 0.480), the red layer's centroid moves from 624.2 to 612.5 nm and the blue layer's from 430.8 to 447.2 nm; the three neutral patches keep their log exposures exactly, while foliage gains (0.062, 0.011, 0.107) and sky changes by (0.015, −0.018, −0.056). The surface is a degree-4 polynomial in the square coordinates, centred on the illuminant's chromaticity with no constant term (zero correction at white), passed through `hanika_sigmoid`, z/1+(z/2)2z/\\sqrt{1 + (z/2)^2}, which bounds it to ±2 stops, and applied as 2surface2^{\\text{surface}}. The module also defines an eight-parameter `logiflex8` window, but `compute_hanatos2025_tc_lut` calls the window function with its default model, `erf4`, which unpacks exactly four parameters.

**conversions.py.** `density_to_light(density, light)` returns 10−D10^{-D} times the light with NaNs set to zero; the printing and scanning stages call it with arrays. Its docstring also accepts a float, but `transmitted[np.isnan(transmitted)] = 0` needs an array, and with `1.0` or a numpy scalar it raises `TypeError` (run with the function's lines copied, since spektrafilm does not import here without the `colour` package). `compute_aces_conversion_matrix` and `rgb_to_raw_aces_idt` build an ACES input transform from the film's sensitivities with `colour.matrix_idt`; nothing in the package calls them, and the test `aces_conversion_matrix==[]` raises `ValueError` under numpy 2.5 when a precomputed matrix is passed, so that path is unused and would fail if used as documented.

**Try it.** Open [the sigmoid-upsampler sketch](#bench-01-spectra-and-density). It starts with the skin coefficients and a metamer of amplitude 0.08: the two swatches match and Portra 400's blue log exposure differs by 0.040. Pick foliage and a shorter period to see a metamer leave \[0,1\]\[0, 1\].

## 1.9 Toward a reusable API

The mathematics of this chapter reduces to a small vocabulary. Spectra are vectors on one grid; a channel is a normalised responsivity; everything else is a function of those two.

```text
Grid(start, stop, step)              the wavelength grid; 380, 780, 5 gives 81 samples
Spectrum(values, kind)               kind ∈ {power, reflectance, transmittance, density, responsivity}
Channels(P)                          three responsivities, each normalised to sum 1
read(P, D) -> Dk                     channel densities: -log10 Σ w 10^-D
transmittance(P, D) -> Tk            10^-read(P, D): the weighted mean transmittance
jacobian(P, D, E) -> K (3×3)         K[k][j] = mean of E[:, j] under w·10^-D, normalised
secant(P, E) -> K (3×3)              read(P, E[:, j]) per dye: Hunt's analytical construction
relativeTo(P, b) -> P'               P·10^-b, renormalised: channels measured from the base
solveLinear(K, Dk) -> c              c = K^-1 Dk, with the condition number of K
sigmaD(D, R) -> σ                    1.4826 · median |D - leave-one-out (2R+1)² mean|
metamericBlack(A, p) -> p'           p - A (AᵀA)^-1 Aᵀ p
sigmoid([c0, c1, c2], u) -> R        1/2 + x / (2 √(1 + x²)), x = c0 u² + c1 u + c2
```

Four laws make good unit tests, and each held on every patch and family of the running example:

- **Bounds.** For every spectral density DD and channel, min⁡D≤\\min D \\le `read(P, D)` ≤∑wD\\le \\sum w D, with the minimum over the channel's support.
- **Base relativity.** `read(P, D + b) − read(P, b)` equals `read(relativeTo(P, b), D)` to rounding.
- **Concavity.** The Hessian of `read` in the dye amounts is −ln⁡10-\\ln 10 times a covariance matrix: no positive eigenvalue, and finite differences agree with it.
- **Metamerism.** `metamericBlack` leaves XYZ unchanged to rounding, and adding it to a reflectance changes film exposures unless the film's sensitivities lie in the span of the colour-matching functions.

## Code in this chapter

| module | what it computes | section |
| --- | --- | --- |
| `chromogen/src/spectrum.js` | the 81-point `Grid`; `Spectrum` with kinds and the add/multiply rules; `table` interpolation; `blackbody`, `gaussian`, `sigmoid` (Jakob–Hanika on uu), CIE fit `cmf`, `xyz` | 1.1, 1.2, 1.8 |
| `chromogen/src/channels.js` | `Channels.read` (channel density), `analytical` (secant KK, each dye alone), `centroids`; `statusM` (Hunt Table 14.1), `apd` (SMPTE table), `printing` (lamp × paper, G&M Eq. 8.1), `scanner` (light × camera, G&M Eq. B.4) | 1.3, 1.4 |
| `chromogen/src/units.js` | `Quantity` with units; stops to log exposure (log⁡102\\log\_{10} 2); refuses density + log exposure | 1.1 |
| `chromogen/src/linalg.js` | `inv3` by cofactors, `solve3`, `minSingular` by Jacobi rotations, bounded `lm` | 1.4 |
| `spektrafilm/utils/spectral_upsampling.py` | hanatos2025 coefficient and spectra tables, `_tri2quad`, `compute_hanatos2025_tc_lut`, `rgb_to_raw_hanatos2025`; `rgb_to_raw_mallett2019`; `erf4` and `logiflex8` windows; poly4 correction surface | 1.8 |
| `spektrafilm/utils/conversions.py` | `density_to_light` (10−D10^{-D} × light); unused ACES input-transform path | 1.8 |
| `data/book-data.json` | the running example's arrays on the 5 nm grid: dyes, base, curves, channel families, lights, patch spectra | 1.1–1.8 |
| `data/smpte_st_2065-2_apd_responsivities.txt` | APD responsivities, 368–728 nm at 2 nm (TB-2014-005 Annex A) | 1.3, 1.6 |

The scripts that produced every number and figure are in `work/01-spectra-and-density/`: `quadrature.py` (1.1), `linearity.py` and `text_numbers.py` (1.2–1.6), `base_gap.py` (1.6), `fig3_noise.py`, `footprint.py`, `gold_noise.py` (1.7), `upsample.py`, `hanatos_port.py`, `conversions_check.py` (1.8), the `fig*.py` generators, and `chromogen_check.js`, which runs Chromogen's own modules on the grey card.

## Exercises

1. **Two minutes.** The grey card reads 1.538 through the narrowband green channel. With transmittance noise σT=0.002\\sigma_T = 0.002 of the clear-film signal, what is its density noise? What is it on the rebate, which reads 0.670 through the same channel?
2. **The soft-min bounds.** For the sky patch, compute the white-LED camera's three channel densities, the weighted means of DD and the minima over each band. Which channel has the largest gap between mean and channel density, and which wavelengths carry its transmitted light?
3. **The secant and the tangent.** Prove from the sign of the second derivative that every entry of the secant KK, off-diagonal ones included, is at most the matching entry of the tangent at zero. Then explain, with the covariance, why the white-LED red channel's slope in cyan at the grey card (0.447) exceeds the tangent at zero (0.360).
4. **Estimator bias from footprints.** For a reduction factor ss between 0.5 and 1, derive the correlation between neighbouring outputs of `region()` for white noise input, and from it the expected ratio of the neighbour-difference estimate to the truth. Check it against 0.754 at s=0.7s = 0.7.
5. **Project: a camera that sees like film.** Using the metameric-black construction, find the reflectance closest to the skin patch (in least squares) that has the same XYZ and changes Portra 400's blue-layer log exposure by 0.1. How large must the perturbation be, and is it still between 0 and 1?

## Sketches in this chapter

4 sketches; choose one from the menu. Drag the parameters, or open the source and edit it: edits stay in this browser.

## Key points

- Spectra are vectors of 81 samples from 380 to 780 nm; a channel's signal is an inner product, and the 5 nm grid is accurate to a few thousandths of a density except where a steep sensitivity meets a steep dye edge.
- At one wavelength the Beer–Lambert–Bouguer law makes spectral density linear in the dye amounts; scatter, non-uniform layers and finite bandwidth break it.
- A channel density is a weighted soft minimum of the spectral density: it lies between the minimum and the weighted mean, its gradient is the dye spectrum's mean under the transmitted light, and its Hessian is −ln⁡10-\\ln 10 times a covariance, so it is concave in the dye amounts.
- The 3×3 matrix KK is a Jacobian; Hunt's dye-alone construction, which Chromogen and the facts file use, is a secant whose worst dye error on the grey card through a white-LED camera is 0.459, while the base-weighted Jacobian at zero dye gives 0.035.
- Linear error grows with density and with the squared coefficient of variation of the dye across the band, and along the neutral direction it is fifteen times smaller than along a single dye.
- Subtracting the rebate's channel density is exact as a division of transmittance, but it equals the dyes' own channel density only in narrow bands; in broadband the base reweights the channel.
- Density noise is 0.434 σT/T0.434\\,\\sigma_T/T, so the dense highlights of a negative are its noisy parts, and a MAD-based estimate from a leave-one-out local mean measures it without being misled by outliers or by overlapping resampling footprints.
- Spectral upsampling picks one spectrum from an infinite set of metamers; Jakob and Hanika's sigmoid family makes the choice bounded and smooth, spektrafilm's hanatos2025 table makes it a 2D lookup times a brightness, and the choice still changes what the film records.

## Further reading

- Hunt, *The Reproduction of Colour*, 6th ed., Sections 14.13–14.20 and Table 14.1: densitometers, specular and diffuse density, Status M, spectral and analytical densities, with the linear system and its limits (pp. 219–237); Section 18.4 for the Callier coefficient.
- Giorgianni and Madden, *Digital Color Management*, 2nd ed., Chapter 8 (Eq. 8.1, printing density) and Appendix B (Eq. B.4, a scanner's effective responsivity).
- James (ed.), *The Theory of the Photographic Process*, 4th ed., Chapter 17: transmission density, its geometric and spectral conditions, and Callier's Q (Fig. 17.12).
- Dainty and Shaw, *Image Science*, Chapter 8, p. 283: transmittance and density fluctuations, the small-fluctuation relation and Trabka's error estimate.
- Jakob and Hanika, "A Low-Dimensional Function Space for Efficient Spectral Upsampling", Computer Graphics Forum 2019: Eqs. 1–3, Algorithms 1–2 and Section 3.1 on the 3D table.
- Mallett and Yuksel, "Spectral Primary Decomposition for Rendering with sRGB Reflectance", EGSR 2019: Eqs. 7–8, the partition of unity and its consequences.
- SMPTE ST 2065-2 and Academy TB-2014-005, Annex A: the APD responsivities as tabulated in the book's data folder.
- *Colour Negatives from First Principles*, Chapters 2 and 3: the same quantities with the photography and chemistry around them, including the covariance form of additivity error (Section 2.5) and the local KK at mid-scale (Section 3.5).
- spektrafilm, `utils/spectral_upsampling.py` and the trailer of `data/luts/spectral_upsampling/hanatos_irradiance_xy_coeffs_250304.lut`: the hanatos2025 table as code and its own description.

2

### The forward model: film, paper and eye as composed functions

The pipeline as a composition of typed maps, each with its domain, codomain and units: scene spectrum → log exposure per layer → (coupling) → dye amounts → spectral density → paper log exposure → paper dye amounts → reflectance → XYZ → display.

A film simulator, and the printing half of a negative inverter, must answer one question: given the light from a scene, what does the print look like? The answer is a chain of nine maps, from a spectrum to log exposures, dye amounts, the negative's spectral density, the paper's exposures and dyes, a reflectance, tristimulus values and display code values, with spatial operators (scatter, halation, grain) inserted where the physics puts them. Each map has a domain, a codomain and units, and most of the bugs in this field are maps applied in the wrong space or in the wrong order. This chapter derives each map from spektrafilm's and Chromogen's code, computes its derivative, and states which pairs commute. With spektrafilm's data for Portra 400 and Portra Endura, the grey card prints at visual density 0.755 and the chain's slope there is 1.33, so one stop of scene exposure moves the print by 0.40 D; after the chapter you can reproduce both numbers, and say which stages may be swapped, cached or tabulated.

## 2.1 Nine typed maps

A **typed map** here is a function together with the space it reads and the space it writes, each with units. Writing the forward model as a composition V∘O∘R∘Pd∘Px∘S∘D∘C∘XV \\circ O \\circ R \\circ P_d \\circ P_x \\circ S \\circ D \\circ C \\circ X is useful only if the types line up: a density cannot be fed to a stage that expects a log exposure, even though both are arrays of three floats. The table lists the stages in the order spektrafilm runs them.

| stage | reads | writes | spektrafilm | Chromogen |
| --- | --- | --- | --- | --- |
| XX expose | scene spectrum E(λ)ρ(λ)E(\\lambda)\\rho(\\lambda) | log exposure per layer uku_k, log H, grey card at 0 | `filming.expose` | (scene targets, `facts.py`) |
| CC couple | uu | inhibited log exposure | `couplers.py` | `pipe.uncouple` (identity) |
| DD develop | log H | dye amount cjc_j in units of εj\\varepsilon_j | `develop.py` | `Stock.develop`, `Curve.at` |
| SS spectral | cc | spectral density D(λ)D(\\lambda) | `compute_density_spectral` | `Stock.spectral` |
| PxP_x print exposure | D(λ)D(\\lambda) | paper log exposure xkx_k | `printing.expose` | `makePrinter().logE` |
| PdP_d paper develop | xx | paper dye amount cp,ic\_{p,i} | `printing.develop` | `paper.develop` |
| RR reflect | cpc_p | reflectance R(λ)R(\\lambda) | `scanning.cmy_to_log_xyz` | `viewLogE` |
| OO observe | R(λ)R(\\lambda) under light EvE_v | XYZXYZ, perfect white Y=1Y = 1 | same | `spectrum.xyz` |
| VV display | XYZXYZ | encoded RGB in \[0,1\]\[0, 1\] | `scanning.scan` | `colour.toSRGB` |

The first map is a weighted sum followed by a logarithm. With sk(λ)=10ℓk(λ)s_k(\\lambda) = 10^{\\ell_k(\\lambda)} the layer's datasheet log spectral sensitivity ℓk\\ell_k,

uk=log⁡10∑λE(λ) ρ(λ) sk(λ) Δλ + κk, u_k = \\log\_{10} \\sum\_\\lambda E(\\lambda)\\,\\rho(\\lambda)\\,s_k(\\lambda)\\,\\Delta\\lambda \\;+\\; \\kappa_k ,

where κk\\kappa_k is chosen so that an 18.4 % grey card gives uk=0u_k = 0, the exposure that the film's rated (box) speed intends. spektrafilm builds the same normalisation into its sensitivities: a comment in `utils/spectral_upsampling.py` says the mid-grey's raw exposure is 1, and `filming.expose` ends with `log_raw = np.log10(np.fmax(raw, 0.0) + 1e-10)`. For a spectrally flat patch the sum scales with the reflectance, so the 90 % white sits at log⁡10(0.90/0.184)=0.689\\log\_{10}(0.90/0.184) = 0.689 and the 3 % black at −0.788-0.788 in every layer; the skin patch of the running example, which is not flat, sits at (0.306, 0.080, −0.046) (`facts.py`). [Chapter 1](#ch-1) covers the sum itself and how a spectrum is obtained from RGB.

Anything that multiplies every wavelength by the same factor (aperture, shutter, `camera.exposure_compensation_ev`, the factor `2 ** autoexposure_ev`) adds a constant to every uku_k: in log space it is a **shift**. `utils/autoexposure.py` computes that shift from the input image: the default `center_weighted` method averages luminance YY under a Gaussian of standard deviation 0.2 of the long edge and returns −log⁡2(Yˉ/0.184)-\\log_2(\\bar Y / 0.184) stops, so a frame whose weighted mean is 0.092 is pushed up by one stop. Shifts matter because they commute with each other and with every per-channel linear operation, which section 2.8 turns into caching rules.

Both code bases make the types explicit. spektrafilm's `runtime/topology.py` names the boundaries between stages as **taps** (`rgb_in`, `log_e_film`, `cmy_film`, `log_e_print`, `cmy_print`, `rgb_out` and others), and each `Node` declares the taps it reads and writes. `run_topology` fires, in order, every node whose inputs are present and stops when the requested tap exists, so `SimulationPipeline.process(image, inject='cmy_film')` prints a negative made elsewhere, and spektrafilm's regression tests store the intermediate taps of a grey ramp, which section 2.6 uses to check this chapter's ports (`pipeline.py` builds the node list, `process.Simulator` wraps it). Chromogen's `pipe.js` names levels instead (`L2` log exposure, `L4` dye amounts, `L5` scanner density, `L6` output colour), and `typecheck` refuses a chain whose stage reads a level the previous one does not write, when the `Pipeline` is built and before any pixel is touched. One level down, `units.js` refuses to add a density to a log exposure, and the law `units.dimension` checks that it does.

## 2.2 The characteristic curve

The **characteristic curve** fjf_j of a layer maps log exposure to the dye amount the layer forms. spektrafilm's profiles store it as a table of 256 values over −3 … 4 log H, and `model/density_curves.interpolate_exposure_to_density` evaluates it by linear interpolation at `log_exposure / gamma_factor`, which stretches the curve about log H = 0 so that the grey card keeps its density. `model/develop.develop` first subtracts each curve's minimum, so the dye amount above the unexposed film is what the rest of the chain sees. For a compact description, `model/parametric.py` offers a five-parameter curve, a difference of two base-10 softplus terms, which Chromogen's `stock.js` ports as `parametric` with an extra offset dmin⁡d\_{\\min}:

f(x)=dmin⁡+γ tlog⁡10 ⁣(1+10(x−x0)/t)−γ slog⁡10 ⁣(1+10(x−x0−D/γ)/s). f(x) = d\_{\\min} + \\gamma\\, t\\log\_{10}\\!\\big(1 + 10^{(x - x_0)/t}\\big) - \\gamma\\, s\\log\_{10}\\!\\big(1 + 10^{(x - x_0 - D/\\gamma)/s}\\big).

Each parameter can be read off the limits. Far below x0x_0 both terms vanish and f→dmin⁡f \\to d\_{\\min}. Far above x0x_0 the first term tends to γ(x−x0)\\gamma(x - x_0), a straight line of slope γ\\gamma through (x0,dmin⁡)(x_0, d\_{\\min}); far above x0+D/γx_0 + D/\\gamma the second term cancels it and f→dmin⁡+Df \\to d\_{\\min} + D. So the curve is the broken line "zero, then slope γ\\gamma, then flat at DD" with its two **corners** at x0x_0 and x0+D/γx_0 + D/\\gamma, rounded over widths tt (the **toe**) and ss (the **shoulder**); at the toe corner the curve sits 0.301 γt0.301\\,\\gamma t above the broken line. The derivative follows from ddu tlog⁡10(1+10u/t)=1/(1+10−u/t)\\frac{d}{du}\\, t\\log\_{10}(1 + 10^{u/t}) = 1/(1 + 10^{-u/t}), the base-10 logistic LL:

f′(x)=γ\[L(x−x0t)−L(x−x0−D/γs)\], f'(x) = \\gamma\\Big\[L\\Big(\\tfrac{x - x_0}{t}\\Big) - L\\Big(\\tfrac{x - x_0 - D/\\gamma}{s}\\Big)\\Big\],

positive everywhere, so ff is strictly increasing and has an inverse. There is no closed form for it, but Newton's method from the straight line x=x0+(y−dmin⁡)/γx = x_0 + (y - d\_{\\min})/\\gamma, guarded by bisection, converges in a few steps. `curves.py` checks both formulas: the derivative agrees with central differences to 8×10−118\\times10^{-11} and the Newton inverse round-trips to 10−1210^{-12}.

Fitting the five parameters plus dmin⁡d\_{\\min} to Portra 400's tables by least squares over −2.5 … 3.5 log H gives the curves of Figure 2.1:

| layer | γ\\gamma | x0x_0 | DD | toe tt | shoulder ss | rms error | max error |
| --- | --- | --- | --- | --- | --- | --- | --- |
| cyan (red layer) | 0.557 | −1.24 | 1.99 | 0.46 | 0.39 | 0.009 | 0.020 |
| magenta (green) | 0.501 | −1.41 | 1.79 | 0.34 | 0.45 | 0.005 | 0.014 |
| yellow (blue) | 0.586 | −1.49 | 2.16 | 0.36 | 0.41 | 0.007 | 0.016 |

The corners sit near −1.4 and +2.2, a straight-line latitude of about 3.6 log H (12 stops). The fit is good in value and poor in slope: the tabulated cyan slope wanders between 0.47 and 0.59 over −1 … +1.5 log H and is 0.488 at the grey card, while the softplus has one straight middle of slope 0.557, because the table is the sum of three sublayer curves (fast, medium and slow emulsions, `density_curves_layers`), each adding its own bump. **Gamma** in this chapter is therefore the parametric γ\\gamma, and the local slope at the grey card is quoted separately when it matters: the inverse of a curve multiplies noise by 1/f′1/f' ([Chapter 3](#ch-3)), and 0.488 against 0.557 is a 14 % difference in that factor.

**Figure 2.1.** Left: Portra 400's tabulated dye-amount curves (grey dots, every ninth table entry) and the parametric fit (solid cyan, dashed magenta, dotted yellow). Red: the magenta layer's broken line, slope γ=0.501\\gamma = 0.501 from the toe corner x0x_0 to the shoulder corner x0+D/γx_0 + D/\\gamma. Right: the cyan layer's slope, from the table (black, finite differences) and from the fit (red); the table's slope at the grey card is 0.488, the fit's straight part 0.557 (film data: spektrafilm, CC BY-SA 4.0).

Chromogen's `Curve` class (`stock.js`) holds any curve as a table, forced strictly increasing by a running maximum plus 10−910^{-9} so that `inverse(y)` can interpolate it backwards; `slope(x)` is a central difference. With `parametric`'s 256 samples over −3 … 4 the table inverse is within 6.4×10−46.4\\times10^{-4} log H of the Newton inverse, and the forward interpolation error is at most h2/8⋅max⁡∣f′′∣=8.8×10−5h^2/8 \\cdot \\max\\lvert f''\\rvert = 8.8\\times10^{-5} D. `shift(dx)` and `scaleGamma(g, about)` transform curves, and `developed()` uses them for push processing with a gamma factor $1 + 0.12\\cdot$push that the source calls a stand-in (spektrafilm's `stocks.py`, which lists 20 films and 8 papers, ships Portra 800 at push 1 and 2 instead).

**From datasheet to dye amount.** A datasheet plots Status M densities of a grey ramp, which are integrals over broad bands, not dye amounts ([Chapter 1](#ch-1)). spektrafilm's curves are already dye amounts, "unmixed" by profile tools that are not in this repository, but the unmixing can be reproduced from the profile's spectra. Each unit dye spectrum εj\\varepsilon_j read through Hunt's Status M responsivities gives

A=(1.0220.0100.002−0.0071.1290.0020.0040.0031.048), A = \\begin{pmatrix} 1.022 & 0.010 & 0.002 \\\\ -0.007 & 1.129 & 0.002 \\\\ 0.004 & 0.003 & 1.048 \\end{pmatrix},

rows R, G, B channels, columns cyan, magenta, yellow dyes. It is nearly diagonal because the effective dye spectra include the masking couplers, whose negative lobes (down to −0.04 for cyan at 555 nm) cancel the dyes' unwanted absorptions. At the grey card the Status M densities above base, (0.717, 0.811, 0.930), become (0.693, 0.721, 0.883) under A−1A^{-1}, against the true (0.687, 0.704, 0.864); over the ramp the error reaches 0.037, the nonlinearity of a broadband integral. Solving the integral equation at each step of the ramp recovers the dye amounts exactly, and tabulating them against the step's log exposure gives the curve.

**Try it.** Open [the curve explorer](#bench-02-forward-model) and set the toe from 0.34 to 0.10: the magenta curve becomes the broken line and its slope plot a box, and the fit to the grey dots worsens in the toe. Then set the inverse density to 0.1 and watch the noise gain 1/f′1/f' rise from its value of 2.0 at the grey card.

## 2.3 Interlayer coupling and the effective gamma matrix

In a real negative, development in one layer slows development in its neighbours through **DIR** (development-inhibitor-releasing) couplers, so a red-only exposure forms more cyan than the same red exposure inside a grey, and colours come out more saturated than three independent curves predict. Hanson and Horton (1952, Eq. 1) wrote each dye as a linear function of all three exposure densities, a 3×3 matrix of gammas; here that matrix appears as a Jacobian.

`model/couplers.py` treats inhibition as a loss of log exposure. With uu the layers' log exposures, ff the datasheet curves (dye amount above minimum) and MM a 3×3 matrix whose entry MkjM\_{kj} is the log exposure lost by receiving layer jj per unit dye formed in donor layer kk, the film stage computes

1. a first development without inhibitor, d0=f(u)d^0 = f(u);
2. the inhibitor each layer receives, a=M⊤d0a = M^\\top d^0 (`compute_exposure_correction_dir_couplers`, `contract('ijk, km->ijm', density, M)`);
3. its spatial spread, a←K∗aa \\leftarrow K * a, a Gaussian of 20 µm plus 6 % of a two-dimensional exponential of decay length 200 µm (`DirCouplersParams`);
4. the final development at the reduced exposure, d=f0(u−a)d = f^0(u - a).

For negatives, `runtime/params_builder._apply_film_specifics` sets

M=(0.3360.3530.3020.1540.3190.3530.1680.2260.273) M = \\begin{pmatrix} 0.336 & 0.353 & 0.302 \\\\ 0.154 & 0.319 & 0.353 \\\\ 0.168 & 0.226 & 0.273 \\end{pmatrix}

(donor rows R, G, B; receiver columns), the "0.42 alpha" result of an optimisation recorded in the comments beside it, under a comment that still reads "just eyeballed, optimize!". The schema's own defaults in `params_schema.DirCouplersParams` are the neighbouring "0.5 alpha high saturation" set, so a caller that skips `digest_params` runs with slightly different values.

**Why f0f^0.** A datasheet curve was measured on a grey ramp and already contains the inhibition a grey suffers, so `compute_density_curves_before_dir_couplers` builds curves f0f^0 that reproduce it on every neutral u=t1u = t\\mathbf 1:

fj0(t−∑kMkjfk(t))=fj(t), f^0_j\\Big(t - \\sum_k M\_{kj} f_k(t)\\Big) = f_j(t),

which it evaluates with `np.interp(log_exposure, log_exposure - f @ M, f)`, the datasheet curve on a shifted axis. At the grey card the layers receive a=(0.485,0.663,0.692)a = (0.485, 0.663, 0.692) log H of inhibition, 1.6 to 2.3 stops. Differentiating the definition with γj=fj′(t)\\gamma_j = f_j'(t) gives fj0′ (1−sj)=γjf^{0\\prime}\_j\\,(1 - s_j) = \\gamma_j with sj=∑kMkjγks_j = \\sum_k M\_{kj}\\gamma_k: at the grey card s=(0.33,0.45,0.47)s = (0.33, 0.45, 0.47), so the uninhibited emulsion has slopes 0.73, 0.87 and 1.03, against the datasheet's 0.49, 0.48 and 0.55 over ±0.1 log H. The ported model reproduces a neutral ramp from −2.5 to +3.0 log H within 0.0012, and it reproduces spektrafilm's stored regression output for a grey ramp (the `cmy_film` tap) to five decimals.

**The Jacobian.** For a uniform area (KK the identity) the film stage is the map u↦d=f0(u−M⊤f(u))u \\mapsto d = f^0(u - M^\\top f(u)). The **Jacobian** of a map from R3\\mathbb R^3 to R3\\mathbb R^3 is the 3×3 matrix of partial derivatives Jij=∂di/∂ujJ\_{ij} = \\partial d_i/\\partial u_j: it is the linear map that best approximates the stage near a point, and here it is exactly Hanson and Horton's gamma matrix, which we call the **effective gamma matrix**. By the chain rule, with ∂ai/∂uj=Mjifj′(uj)\\partial a_i/\\partial u_j = M\_{ji} f_j'(u_j),

J=diag⁡ ⁣(f0′(u−a)) (I−M⊤diag⁡(f′(u))). J = \\operatorname{diag}\\!\\big(f^{0\\prime}(u - a)\\big)\\,\\big(I - M^\\top \\operatorname{diag}(f'(u))\\big).

At the grey card, with central differences of ±0.05 log H on the ported tables,

J(0)=(0.610−0.056−0.065−0.1540.740−0.107−0.145−0.1710.874), J(0) = \\begin{pmatrix} 0.610 & -0.056 & -0.065 \\\\ -0.154 & 0.740 & -0.107 \\\\ -0.145 & -0.171 & 0.874 \\end{pmatrix},

rows cyan, magenta, yellow dye, columns red, green, blue layer; the product formula agrees with it to 0.008. The diagonal is 1.2 to 1.7 times the datasheet slope, the off-diagonals are negative, and each row sums to the neutral slope (0.489, 0.479, 0.558 against 0.488, 0.494, 0.526, the difference being the double interpolation of f0f^0): a grey keeps the datasheet's contrast while a colour difference is amplified. In the toe at u=−1.5u = -1.5 the off-diagonals fall below 0.02, because both factors carry a slope: a donor in its toe releases little inhibitor, and a receiver in its toe has no slope for the lost exposure to act on.

**Before or after the curve.** Many image pipelines imitate interimage effects with a 3×3 matrix on densities after the curve. The same MM used there, d=(I−M⊤)f1(u)d = (I - M^\\top) f_1(u) with f1=(I−M⊤)−1ff_1 = (I - M^\\top)^{-1} f so that neutrals still reproduce, gives diagonal gammas of 1.43, 1.93 and 2.17, more than twice the coupled model's, and drives magenta to −1.20 on a red ramp with green and blue at the grey card. The fair comparison is a matrix BB with Bdiag⁡(B−1γ)=J(0)B\\operatorname{diag}(B^{-1}\\gamma) = J(0), which agrees with the coupled model to first order at the grey card. Solving for BB (unit diagonal) gives

B=(1−0.076−0.076−0.2451−0.118−0.255−0.2441), B = \\begin{pmatrix} 1 & -0.076 & -0.076 \\\\ -0.245 & 1 & -0.118 \\\\ -0.255 & -0.244 & 1 \\end{pmatrix},

which matches J(0)J(0) to 0.011. With green and blue held at the grey card, a red ramp moves magenta and yellow almost identically in both models (within 0.046 and 0.025; Figure 2.2). With green and blue in the toe at −1.5, a dark red object, the coupled model leaves magenta at 0.004 because there is nothing to inhibit, while the matrix after the curve subtracts density anyway and reaches −0.333 at uR=+1u_R = +1. A curve does not commute with a linear map: inhibition acts on exposure, and the curve decides what a change of exposure is worth at each point.

**Figure 2.2.** Left: magenta dye amount against the red layer's log exposure, with the green and blue layers held at the grey card (upper curves) or at −1.5 log H (lower curves): spektrafilm's coupling before the curve (solid), a density matrix after the curve matched to the same effective gamma matrix at the grey card (red, dashed), and no coupling (dotted). Right: cyan dye across the edge of a red object (uR=+1u_R = +1 beside a grey card) with the inhibitor diffused by spektrafilm's kernel (solid) and as two uniform areas (dotted); the overshoot and undershoot are the adjacency effect (film data: spektrafilm, CC BY-SA 4.0).

The spatial step adds an edge effect: near the edge of a red object part of its self-inhibitor diffuses into the grey neighbour, so the cyan dye, 1.399 inside and 0.687 outside, overshoots to 1.484 and undershoots to 0.615 within a few micrometres of the edge (right panel). Chromogen has no DIR model: `pipe.uncouple` is the identity with a warning.

**Try it.** In [the coupling order sketch](#bench-02-forward-model), lower the green and blue exposure from 0 to −1.5 and watch the dashed magenta curve cross zero while the solid one stays flat; then set the coupler amount to 0 and see both collapse onto the datasheet curve and the off-diagonal entries of the printed gamma matrix go to zero.

## 2.4 Scatter and halation: convolution before the logarithm

Silver halide crystals scatter light sideways over a few micrometres, and light that passes through all the layers is reflected from the rear of the base and exposes the emulsion again over a few tenths of a millimetre: **halation**, a red glow around bright sources, because the red-sensitive layer lies nearest the base. Both redistribute exposure, so both are **convolutions**: with K≥0K \\ge 0 a kernel of total weight 1, (K∗E)(x)=∑yK(x−y) E(y)(K * E)(x) = \\sum_y K(x - y)\\,E(y) is a weighted average, and a uniform field such as the grey card is unchanged.

Photons add and log exposures do not, so the convolution must act on EE before the logarithm. `filming.expose` does exactly that: highlight boost, diffusion filter, lens blur and `diffusion.apply_halation_um` all act on the linear `raw` array before `np.log10`. `apply_halation_um` has two passes:

E1=(1−w) Gσc∗E0+w Xλt∗E0,E2=E1+a∑k=13wk Gσhk∗E11+a, E_1 = (1 - w)\\,G\_{\\sigma_c} * E_0 + w\\,X\_{\\lambda_t} * E_0, \\qquad E_2 = \\frac{E_1 + a\\sum\_{k=1}^{3} w_k\\, G\_{\\sigma_h\\sqrt k} * E_1}{1 + a},

where GσG\_\\sigma is a Gaussian of standard deviation σ\\sigma and XλX\_\\lambda the two-dimensional exponential e−r/λ/(2πλ2)e^{-r/\\lambda}/(2\\pi\\lambda^2), which `fast_gaussian_filter.fast_exponential_filter` replaces by three Gaussians of widths 0.54λ0.54\\lambda, 1.52λ1.52\\lambda and 2.77λ2.77\\lambda (a fit the source calls a placeholder). For the red layer σc=2.2\\sigma_c = 2.2 µm, λt=9.3\\lambda_t = 9.3 µm and w=0.78w = 0.78 (`HalationParams`). The halation pass sums three bounces with weights 4/7, 2/7 and 1/7; `params_builder._HALATION_PRESETS` sets σh=65\\sigma_h = 65 µm for still film and 50 µm for cine, and aa from the profile's antihalation tag: (0.015, 0.005, 0) for the red, green and blue layers of a stock with a strong antihalation layer such as Portra 400, (0.08, 0.02, 0) for a weak one and (0.30, 0.10, 0.015) for none. Dividing by 1+a1 + a keeps the total exposure.

Gaussians compose by adding variances, so the red layer's whole kernel is a mixture of 16 Gaussians, 98.5 % of the weight in scatter and 1.5 % in halation, and its response to a straight edge is a weighted sum of normal distribution functions, computed exactly in `halation.py`. Figure 2.3 takes an edge from log H +2.5 (a window, 8.3 stops above the grey card) to −1.0. In exposure, 1.5 % of 102.510^{2.5} is 4.7 times the dark side's own exposure, so the dark side's cyan rises from 0.157 to 0.895 at 50 µm, 0.573 at 100 µm and 0.244 at 200 µm, and stays 0.05 above the dark level out to 224 µm; with the weak and absent antihalation presets the cyan at 100 µm is 0.898 and 1.173.

**Figure 2.3.** Left: cyan dye across an edge from log H +2.5 to −1.0, exposed through spektrafilm's red-layer kernel for a still film with a strong antihalation layer, convolved in linear exposure before the logarithm (red), and the same kernel applied to the developed dye amount (dashed); dotted, no kernel. Right: the red layer's log exposure for the two orders; log⁡10(K∗E)\\log\_{10}(K * E) lies above K∗log⁡10EK * \\log\_{10} E everywhere, as Jensen's inequality requires (film data: spektrafilm, CC BY-SA 4.0).

Applied to the dye amount, the same kernel mixes 1.5 % of a density difference of 1.8 into the dark side, an excess of 0.013 at 50 µm: no visible halo, while the scatter softens the bright side, which the exposure-domain version leaves sharp because halving an exposure in the shoulder barely changes the dye. The right panel shows why. The logarithm is concave, so for any averaging kernel **Jensen's inequality** gives log⁡10(K∗E)≥K∗log⁡10E\\log\_{10}(K * E) \\ge K * \\log\_{10} E, with equality only where EE is constant under the kernel; at 50 µm from this edge the two are +0.404 and −0.973 log H. A blur in the log or density domain is a weighted geometric mean of exposures, dominated by the dark side; a physical blur is an arithmetic mean, dominated by the bright side.

The camera's diffusion filters (`apply_diffusion_filter_um`, off by default) follow the same rule, Eout=(1−ps)E+ps Ks∗EE\_{\\text{out}} = (1 - p_s)E + p_s\\,K_s * E with KsK_s a mixture of exponentials per filter family. The Studio's Halation control is a cheaper version: `params.js` turns it into `halAmt`, the fraction of blurred film exposure added back to the red and green layers, 0.30 and 0.08 at Halation 100 (`spec.js`), spektrafilm's no-antihalation value for red.

**Try it.** In [the halation edge](#bench-02-forward-model), switch the domain from exposure to density and watch the red halo disappear; then set the domain back, raise the strength from 0.015 to 0.30 and lower the bright side from +2.5 to +0.5 log H: the halo shrinks with the edge's contrast, because what spreads is a fraction of the bright side's exposure.

## 2.5 Grain: a Poisson–binomial density

A developed layer is not a continuous dye film but a collection of dye clouds, one per developed crystal, so the dye amount in a small area fluctuates around its mean. The standard measure is the **RMS granularity**: the standard deviation of density read through a circular aperture 48 µm across, at a mean density of 1.0, times 1000 (Vitale, p. 11, who quotes values from 5 to 50 and about 5 for some colour negatives). The aperture matters because averaging over a larger area averages more clouds. **Selwyn's law** says that for a random arrangement of image units the product G=AσA2G = A\\sigma_A^2 of aperture area and variance does not depend on the aperture, as long as the aperture holds many units (Dainty & Shaw, p. 58, Eqs. 14–16, where S=σ2AS = \\sigma\\sqrt{2A} is the Selwyn coefficient). GG is the quantity a model should get right; the RMS value at 48 µm is 1000G/1809.6 μm21000\\sqrt{G / 1809.6\\,\\mu\\mathrm m^2}.

spektrafilm's `model/grain.py` draws the dye amount of each pixel from a two-stage random count. A **Poisson** random variable with mean λ\\lambda counts independent events (here, crystals in a pixel) and has variance λ\\lambda; a **binomial** variable counts how many of nn trials succeed with probability pp. `layer_particle_model` takes the pixel's mean dye amount DD, the layer's maximum Dmax⁡D\_{\\max}, the number of crystals per pixel NN (pixel area over crystal area) and a **uniformity** uu close to 1, and computes

p=D/Dmax⁡,s=1−u p,n∼Poisson(N/s),k∼Binomial(n,p),D^=k Dmax⁡N s. p = D / D\_{\\max}, \\quad s = 1 - u\\,p, \\quad n \\sim \\text{Poisson}(N/s), \\quad k \\sim \\text{Binomial}(n, p), \\quad \\hat D = k\\,\\frac{D\_{\\max}}{N}\\,s .

A binomial thinning of a Poisson count is again Poisson, with mean pN/spN/s, so D^\\hat D is a scaled Poisson variable with

E\[D^\]=D,Var⁡\[D^\]=(Dmax⁡sN)2pNs=Dmax⁡N D (1−uDDmax⁡). \\mathrm E\[\\hat D\] = D, \\qquad \\operatorname{Var}\[\\hat D\] = \\Big(\\frac{D\_{\\max}s}{N}\\Big)^2\\frac{pN}{s} = \\frac{D\_{\\max}}{N}\\,D\\,\\Big(1 - u\\frac{D}{D\_{\\max}}\\Big).

A Monte Carlo of 400,000 pixels in `grain.py` reproduces the variance to 0.1 %. For D≪Dmax⁡D \\ll D\_{\\max} the variance grows in proportion to DD, as for counted grains; near Dmax⁡D\_{\\max} the factor 1−uD/Dmax⁡1 - uD/D\_{\\max} drives it towards zero, because a layer whose crystals have all developed has nothing left to vary.

Because NN is the pixel area divided by the crystal area aa, the pixel variance times the pixel area is

G(D)=σ2Apx=a Dmax⁡ D (1−uD/Dmax⁡), G(D) = \\sigma^2 A\_{\\text{px}} = a\\,D\_{\\max}\\,D\\,(1 - uD/D\_{\\max}),

with no pixel size left in it: the model obeys Selwyn's law at the pixel by construction. The default path (`GrainParams.sublayers_active`) splits each channel into the profile's three sublayers ii, with maxima Dmax⁡,iD\_{\\max,i}, fractions fif_i of the channel's maximum and crystal areas ai=0.2 μm2a_i = 0.2\\,\\mu\\mathrm m^2 times (1.6, 1.6, 3.2) per channel times (2, 1, 0.5) per sublayer, so the fast sublayer has the largest crystals; summing variances, G=∑iDi Dmax⁡,i (ai/fi) (1−uDi/Dmax⁡,i)G = \\sum_i D_i\\,D\_{\\max,i}\\,(a_i/f_i)\\,(1 - uD_i/D\_{\\max,i}). For Portra 400 this predicts RMS granularities of 9.1, 7.4 and 13.8 for the cyan, magenta and yellow layers at D=1.0D = 1.0, rising to about 11, 10 and 17 near D=0.3D = 0.3, where the fast sublayer carries most of the dye, and falling as it saturates (Figure 2.4). The Portra 400 datasheet gives a Print Grain Index, not an RMS granularity, so Kodak's value cannot be compared.

**Figure 2.4.** Left: RMS granularity at 48 µm against dye amount for Portra 400's three layers from spektrafilm's sublayer model: closed form 1000G/A481000\\sqrt{G/A\_{48}} (lines) and Monte Carlo through 48 µm apertures on 2048² fields of 2 µm pixels after the code's blurs (circles). Right: Selwyn's G=σ2AG = \\sigma^2 A for the green layer at D=1D = 1 against aperture diameter, rising to the closed form as the aperture outgrows the blur (film data: spektrafilm, CC BY-SA 4.0).

The Monte Carlo points sit 2 to 6 % below the lines because the code then blurs each sublayer by od\\sqrt{\\text{od}} pixels (od =Dmax⁡,i/Ni= D\_{\\max,i}/N_i, one crystal's dye amount, NiN_i the sublayer's crystals per pixel) and the sum by `GrainParams.blur` = 0.65 pixels. A blur spreads each pixel's noise over its neighbours without changing its total, so a large aperture sees the same GG while a narrow one loses what spread outside it: GG climbs from 0.017 µm²·D² at one pixel to 0.091 at 96 µm, against 0.098. The sublayer blur is Dmax⁡,i ai/fi\\sqrt{D\_{\\max,i}\\,a_i/f_i} µm whatever the pixel size (a quantity in D⋅μm\\sqrt{\\mathrm D}\\cdot\\mu\\mathrm m, despite the name `blur_dye_clouds_um`), but the 0.65 is in pixels. Simulated at 1, 2 and 4 µm pixels, the green layer's pixel σ is 0.089, 0.066 and 0.035 while its RMS at 48 µm stays at 7.4, 7.2 and 6.9: Selwyn's law, with the coarsest grid losing 6 % to its wider blur. (`add_micro_structure` is inactive for pixels above 0.6 µm.)

Because the model draws one count per pixel, its noise is white at the pixel scale and the grain's apparent size follows the scan, not the film; Newson et al. (2017) draw grains as discs in continuous coordinates instead, which "can be rendered at any resolution", at a much higher cost. The Studio's grain is a third option: `params.js` passes `K.GRAIN_SIGMA` = 0.035 at Grain 100, a dye-amount σ at c=1c = 1 on a 24 µm aperture, scaled by area for other grain sizes (`spec.js`), so it states its granularity directly in Selwyn's terms.

## 2.6 Printing: the print as a second film

To print, an enlarger shines a lamp through the negative onto colour paper, which is a second negative film with its own sensitivities and curves. The paper's log exposure in layer kk is the first map of the chain again, with the negative's transmittance in place of the scene:

xk=log⁡10∑λL(λ) F(λ) 10−D(λ) skp(λ) Δλ + ℓk, x_k = \\log\_{10} \\sum\_\\lambda L(\\lambda)\\,F(\\lambda)\\,10^{-D(\\lambda)}\\,s^p_k(\\lambda)\\,\\Delta\\lambda \\;+\\; \\ell_k ,

where LL is the lamp, FF the filter pack, skps^p_k the paper's sensitivities and ℓk\\ell_k the **printer lights**, one log-exposure offset per paper layer. Chromogen's `print.js` stores them as `Lights`, reports them in **printer points** of 0.025 log H, and its `shift` refuses a density, citing Hunt 14.17 (section 2.8 shows why). `makePrinter` computes xkx_k as written; its `greyPatch` finds by Levenberg–Marquardt ([Chapter 3](#ch-3)) the lights that print a patch as a neutral of reflectance 0.184, (−0.454, −0.503, −0.471) for the running example's grey card under a 3,200 K lamp (`facts.py`). Without a known grey, `pipe.print` and the Studio's `params.autoLights` integrate to grey (Hunt 16.7): with Δ\\Delta the frame's large-area transmission density in the paper's bands minus the aim's and mm its mean, ℓ=ℓaim+m+α(Δ−m)\\ell = \\ell\_{\\text{aim}} + m + \\alpha(\\Delta - m) with α=0.75\\alpha = 0.75, which removes three-quarters of a colour cast and all of a density error.

spektrafilm balances with filters. `color_filters.DichroicFilters.apply_cc` gives a filter of vv CC units the transmittance 10−v/10010^{-v/100} in its blocking band and 1 outside; the default `custom` filters have error-function edges at 516 nm (yellow), 500 and 610 nm (magenta) and 607 nm (cyan), and the lamp is `illuminants.standard_illuminant('TH-KG3')`, a 3,400 K blackbody through a Schott KG3 heat filter. If a band covered exactly one paper layer, vv CC would shift that layer by −v/100-v/100 log H (0.4 printer points per CC). The real edges overlap, so at the neutral pack, per CC unit,

∂x∂v=(−0.0092−0.00070.00000.0000−0.0087−0.00160.00000.0000−0.0100), \\frac{\\partial x}{\\partial v} = \\begin{pmatrix} -0.0092 & -0.0007 & 0.0000 \\\\ 0.0000 & -0.0087 & -0.0016 \\\\ 0.0000 & 0.0000 & -0.0100 \\end{pmatrix},

(rows layers, columns filters): diagonal to within a fifth. The neutral pack comes from `data/filters/neutral_print_filters.json` by paper, lamp and film (`params_builder.apply_database_neutral_print_filters`): C 0, M 51.57, Y 52.53 for Portra 400 on Portra Endura, replacing the `EnlargerParams` defaults of 0, 65, 55, and `filter_enlarger_source.EnlargerService` adds the user's shifts to it.

**One normalisation, one consequence.** `printing._compute_exposure_factor_midgray` divides every paper exposure by the geometric mean of the three exposures that the film's mid-grey would receive, so the mid-grey's mean paper log H is exactly 0 whatever the filters. Every filter change is therefore projected onto the colour plane: with the normalisation the derivative becomes

∂x∂v=(−0.00610.00240.00380.0031−0.00560.00230.00310.0031−0.0061), \\frac{\\partial x}{\\partial v} = \\begin{pmatrix} -0.0061 & 0.0024 & 0.0038 \\\\ 0.0031 & -0.0056 & 0.0023 \\\\ 0.0031 & 0.0031 & -0.0061 \\end{pmatrix},

whose columns sum to zero: a filter changes colour and not density, and density is left to `print_exposure`, a single multiplicative factor, which is a shift of all three xkx_k.

**A finding: NaN is opaque.** The first port of this stage printed the grey card cyan (a∗=−19a^\* = -19) with the database's filters. spektrafilm keeps `NaN` where a profile has no data, and `utils/conversions.density_to_light` sets the transmitted light to zero there. Portra 400's base density is `NaN` from 705 nm up, so spektrafilm's enlarger sees an opaque negative exactly where Portra Endura's red sensitivity peaks (27 % of the lamp-weighted red sensitivity lies at 705 nm and above), while Chromogen's `stock.js` (`v || 0`) and `facts.py` read the same `NaN` as zero density. With `NaN` read as opaque, the mid-grey's paper log exposures become (0.004, 0.005, −0.009), the grey prints at (a∗,b∗)=(−0.5,−4.2)(a^\*, b^\*) = (-0.5, -4.2) under a 5,000 K light (spektrafilm views under D50), and the port matches spektrafilm's stored regression output for a grey ramp (the `rgb_out` tap) within 0.017 in sRGB over the middle eleven steps. The database's filters are right for spektrafilm's convention and 20 CC wrong for Chromogen's; a model that mixes the two data paths inherits a 0.18 log H red error.

**The paper.** `develop.develop_print_morph` evaluates the profile's fitted model rather than its table: per channel cp(x)=∑iAi Φ((x−μi)/σi)c_p(x) = \\sum_i A_i\\,\\Phi((x - \\mu_i)/\\sigma_i), three normal distribution functions, within 0.0034 of the table. `utils/morph_curves.apply_print_curves_morph` divides each σi\\sigma_i and μi\\mu_i by a gamma factor gg, which turns cp(x)c_p(x) into cp(gx)c_p(gx), a stretch about x=0x = 0 that keeps the mid-grey fixed (exactly, unless the floor σ≥0.05\\sigma \\ge 0.05 binds). At the grey card Portra Endura forms paper dye (0.665, 0.548, 0.499) with slopes 2.36, 1.98 and 1.95, about four times the negative's. Chained through the film's 0.5, the printing step and the paper, a stop of scene exposure changes the print's visual density by 1.33×0.301=0.401.33 \\times 0.301 = 0.40: the print is a second film whose high gamma undoes the negative's low one. The paper can also be flashed: `printing._compute_raw_preflash` adds a uniform exposure through the film base, x↦log⁡10(10x+ϕ)x \\mapsto \\log\_{10}(10^{x} + \\phi), which lifts the toe and leaves the rest of the curve, and the Studio's `paperX` applies the same formula with ϕ=0.35 p/100⋅10g−0.6\\phi = 0.35\\,p/100 \\cdot 10^{g - 0.6} for Preflash pp.

The Studio's `frameParams` adds every light the user can set (automatic balance, roll consistency, match to a reference frame, exposure in stops of 0.301 log H, Warmth at 1.3 mired per unit, Tint along (−13,23,−13)(-\\tfrac13, \\tfrac23, -\\tfrac13)) into one vector of paper log H offsets, `lights.total`, before `paperX` applies the shadow and highlight pads, a gamma about the aim point gg and the flash. The lights are pure shifts and the pads and gamma are affine in xx; only the flash is a curve, and all of them act per pixel on xx in the print shader, which is why the Studio can change them without rebuilding a table (section 2.8).

## 2.7 Viewing: reflectance, flare and the display

Both code bases turn the print's spectral density Dp(λ)=∑icp,i εp,i(λ)+bp(λ)D_p(\\lambda) = \\sum_i c\_{p,i}\\,\\varepsilon\_{p,i}(\\lambda) + b_p(\\lambda) into a reflectance as if it were a transmission, R(λ)=10−Dp(λ)R(\\lambda) = 10^{-D_p(\\lambda)}: spektrafilm in `scanning.cmy_to_log_xyz` (NaN-as-opaque again, so Endura reflects nothing above 700 nm), Chromogen in `makePrinter().viewLogE`. The paper's data are reflection densities from a Status A densitometer, which lights and reads at different angles so that the surface's mirror reflection is excluded, and the formula reproduces those readings on the measured neutrals: paper white reflects Y=0.813Y = 0.813 of a 5,000 K light and the densest black is 2.37, close to Hunt's "2.4 or more" for glossy papers (Hunt 13.10).

What happens inside the paper is not a single pass. Light crosses the dye layer, is scattered by the white base, and most of it is reflected back at the gelatin–air surface for another pass: only 38.6 % escapes at the first attempt (Hunt 13.9). US 6,633,408 (col. 15) models this with a double pass through the dyes and **Saunderson's correction** for the surface,

R′(λ)=(1−k1)(1−k2) Rp(λ)1−k2Rp(λ),Rp(λ)=Rg(λ) e−2(cKC+mKM+yKY), R'(\\lambda) = \\frac{(1 - k_1)(1 - k_2)\\,R_p(\\lambda)}{1 - k_2 R_p(\\lambda)}, \\qquad R_p(\\lambda) = R_g(\\lambda)\\,e^{-2(cK_C + mK_M + yK_Y)},

with k1≈0.04k_1 \\approx 0.04 the fraction of incident light reflected by the surface, k2≈0.6k_2 \\approx 0.6 the fraction of internal light reflected back (col. 16), RgR_g the base's reflectance and KK the dyes' absorptivities. Writing dd for the dyes' single-pass base-10 density and differentiating the measured density D′=−log⁡10R′D' = -\\log\_{10} R',

dD′dd=21−k2Rp, \\frac{dD'}{dd} = \\frac{2}{1 - k_2 R_p},

which is 5 for a thin layer (Rp→1R_p \\to 1), 2.9 at d=0.15d = 0.15 and 2.0 at d=1d = 1 (Figure 2.5, right): Hunt's low densities magnified "by factors as large as five or more" (Hunt 13.9). Measured reflection density is therefore not proportional to dye amount, and the dyes' small unwanted absorptions grow fastest. spektrafilm's model, linear in measured density, is exact on the measured neutrals and approximate for mixtures; the patent's is the physical one, at the price of fitting absorptivities by factor analysis.

The viewer, unlike the densitometer, sees the surface: under diffuse room light a matte print returns about k1k_1 of the light whatever the dyes below, so the viewed reflectance is R′+k1R' + k_1. Giorgianni and Madden (App. E, Eqs. E.1–E.7) give the general **viewing flare**: add pf/100p_f/100 of the white's reflectance to every point, at the flare light's chromaticity; `printing.py` reproduces their example (white at 0.12, 1 % flare: 2.0 becomes 1.7548 and 1.0 becomes 0.9682). Hunt's room (a black read at 2.40 and seen at about 1.55) implies 2.4 % of a perfect white. The Studio's `params.js` sets `flareXYZ` = D65 × (Blacks/100) × (`FLARE_MAX` = 4)/100 × YpaperY\_{\\text{paper}}, added in the shader as `XYZ = (XYZ + flareXYZ) * gain` with `gain` =2Whites/100/Ypaper= 2^{\\text{Whites}/100}/Y\_{\\text{paper}}; the default Blacks of 12 is 0.48 % of paper white, and the maximum is Saunderson's k1k_1. spektrafilm's `glare.add_glare` adds a lognormal random field of mean 0.03 % of the light's XYZ; `color_reference` can instead rescale YY so that the paper's black and white land on chosen levels (off by default), a ratio that keeps chromaticity, where additive flare moves every colour towards white.

**Figure 2.5.** Left: print visual density against scene log exposure for the Portra 400 to Portra Endura chain under a 5,000 K light, read as a densitometer reads it (single pass, 10−Dp10^{-D_p}), with the Studio's default flare of 0.48 % of paper white (dashed), and with Saunderson's surface reflection k1=4 %k_1 = 4\\,\\% reaching the eye (red). Right: measured reflection density against the dyes' single-pass internal density from Saunderson's correction with k1=0.04k_1 = 0.04, k2=0.6k_2 = 0.6 (red), and a plain double pass 2d2d (dashed) (film and paper data: spektrafilm, CC BY-SA 4.0).

Flare compresses the shadows and leaves the highlights: the densest black falls from 2.37 to 2.09 with the Studio's default and to 1.35 with k1k_1, the slope at the grey card from 1.33 to 1.30 and 1.08; spektrafilm's glare moves the black only to 2.34. Papers carry more contrast than a neutral reproduction needs because the room takes some back.

**Eye and display.** The observe map is X=k∑λEvR xˉX = k\\sum\_\\lambda E_v R\\,\\bar x and likewise YY, ZZ, with k=1/∑Evyˉk = 1/\\sum E_v\\bar y so that a perfect white has Y=1Y = 1 (CIE 1931 tables in spektrafilm, a fitted approximation in Chromogen's `spectrum.js`). A display shows D65 white, so Chromogen's `colour.adapt` applies a **chromatic adaptation**: Bradford's matrix takes XYZXYZ to cone-like responses, each is scaled by the ratio of the two whites' responses, and the inverse matrix takes them back. `toSRGB` then applies the sRGB matrix, clips to \[0,1\]\[0, 1\] and encodes (12.92v12.92v below 0.0031308, 1.055v1/2.4−0.0551.055v^{1/2.4} - 0.055 above). The grey card's print, XYZ=(0.1706,0.1750,0.1686)XYZ = (0.1706, 0.1750, 0.1686) under the 5,000 K light, adapts to (0.1664, 0.1754, 0.2131), becomes linear sRGB (0.164, 0.177, 0.199) and is encoded as (0.441, 0.457, 0.483), the colour `#70757b` (`colour_check.js`, running `colour.js` itself). spektrafilm does the same with `colour.XYZ_to_RGB` and the viewing light's chromaticity.

**Soft knees.** Values outside the display's cube must be brought in, and a hard clip changes hue and leaves visible edges. spektrafilm's `utils/gamut_compression.py` uses one primitive throughout, the **Reinhard knee** on a normalised distance dd:

d′=t+s n(1+np)1/p,n=d−ts,s=ℓ−t, d' = t + s\\,\\frac{n}{(1 + n^p)^{1/p}}, \\qquad n = \\frac{d - t}{s},\\quad s = \\ell - t,

the identity below a threshold tt, asymptotic to the limit ℓ\\ell, with slope (1+np)−1−1/p(1 + n^p)^{-1 - 1/p}. At the output, `compress_rgb` (default `cam16ucs`) divides CAM16-UCS chroma by the largest in-gamut chroma at that lightness and hue (a table built by bisection), applies the knee with (t,ℓ,p)=(0,1,6)(t, \\ell, p) = (0, 1, 6) and converts back, after a one-sided knee (0.7, 1, 2.2) on lightness has pulled super-whites below white. With t=0t = 0 the knee is never the identity but nearly is in the middle: dd = 0.5, 0.8, 1 and 2 become 0.4987, 0.770, 0.891 and 0.997. (The `OutputGamutCompressSpec` docstring calls both `cam16ucs` and `oklch` the default; the code says `cam16ucs`.) At the input, the same knee pulls CIE xyxy radially towards the spectral locus, baked into the spectral-upsampling table by `remap_tc_lut_for_compression`.

A knee does not commute with the maps around it: a gain of 1.25 after the knee sends d=0.9d = 0.9 to 1.048, outside the cube the knee had just guaranteed, and before it to 0.935. So the compression must be the last colour operation before encoding. spektrafilm compresses after glare and adaptation, which is right, but `scanning.scan` then applies the scanner's unsharp mask (default σ 0.7 pixel, amount 0.7), and a step from 0.05 to 0.9 in linear RGB overshoots to 1.028 and −0.078, against the module's statement that the output is in \[0,1\]\[0, 1\] without a downstream clip (`unsharp.py`).

**Try it.** In [the print chain](#bench-02-forward-model), raise the flare from 0.48 % to 4 % and watch the wedge's dark patches merge while the light ones barely change. Set the flare to 0 and switch on Saunderson's surface model, which reads the profile's dye spectra as internal single-pass densities: the grey card darkens from 0.755 to 1.12 and the paper white from 0.09 to 0.21. Then, with the flare back at 0.48 % and Saunderson off, move the red light by +10 points (0.25 log H): the grey card turns cyan (a∗=−20.7a^\* = -20.7) and darkens from 0.746 to 0.956, because one light alone changes density as well as colour.

## 2.8 Composition laws: what commutes and what it buys

Two stages **commute** when applying them in either order gives the same result. Every law below was checked numerically on the ported stages (`laws_check.py`, `halation.py`, `couplers_match.py`, `knees.py`), and each one either licenses a shortcut or forbids one.

| law | holds | check | what it allows or forbids |
| --- | --- | --- | --- |
| shifts in log H compose by addition | exactly |  | sum all lights into one vector before use |
| printer lights factor out of the spectral sum: x(D,ℓ)=x(D,0)+ℓx(D, \\ell) = x(D, 0) + \\ell | exactly | error 2×10−162\\times10^{-16} | tabulate the negative-to-paper map once, apply lights per pixel |
| a curve commutes with a shift | no | +0.1 log H adds 0.021 dye in a highlight, 0.219 at the grey card | balance in log H, never in density |
| a per-channel scale commutes with a normalised convolution | exactly | 0 to rounding | exposure compensation before or after halation |
| a convolution commutes with the logarithm | no | +0.404 vs −0.973 log H at 50 µm | blur in linear exposure only |
| coupling commutes with the curve | no | magenta 0.004 vs −0.333 | DIR acts before development |
| a knee commutes with a gain | no | 0.935 vs 1.048 | compress last |

The second law is what makes a real-time printer possible. Because a printer light multiplies the whole spectral sum, Chromogen's `pipe.print` evaluates the expensive part, negative to paper log exposure without lights, as a 17³ table (`printA`) whose cache key leaves the lights out, then per pixel adds the lights, reads the paper curve and looks up a second 25³ table from paper dyes to XYZXYZ (`printB`); the Studio's print shader does the same with every control that is a shift or a per-channel map of xx ([Chapter 4](#ch-4) measures the cost and the interpolation error). Real dichroic filters are not pure shifts (section 2.6), so a filter change invalidates such a table. The third law is the reason `Lights.shift` throws on a density: a printer-light change of 0.1 log H moves the paper's green dye by 0.021 near the paper white, 0.219 at the grey card and 0.092 in the shadows, while a density offset with the same effect at the grey card would add 0.198 everywhere, ten times the light's effect near the paper white. The fourth law has a limit: a 3×3 mixing of the channels commutes with a kernel only if all three channels share it, and halation does not (strengths 0.015, 0.005 and 0), so any channel mixing has to happen in the spectral step before the kernels, as spektrafilm's order does. The coupling law decides what can be tabulated: with diffusion off, the whole film stage is a pointwise map from three log exposures to three dye amounts, and spektrafilm's `debug.lut_mode` (in `digest_params`) switches off exactly the stages that break this, the spatial and random effects and the highlight boost, which "normalizes by the image-wide max".

**The laws Chromogen checks.** `laws.js` makes a law a value: `law(name, gen, prop, meta)` refuses to build one without a `justifies` field ("without it this is an example, not a law"), and `check(suite, { n, seed })` draws nn inputs from a seeded `mulberry32` generator and, on a failure, shrinks the counterexample towards zero and two decimals. `suite.js` ships eight: the Beer–Lambert homomorphism (the density of a product of transmittances is the sum of densities), associativity of document merging, `curve.inverse`, the narrowband channel matrix, `channels.rebate.zero`, the dye solve round trip, `print.balance.grey` and `units.dimension`. All eight pass with n=30n = 30 in 116 ms. One cannot fail: `channels.rebate.zero` reads the base through the same channels twice and checks that the difference is zero. None of them is a commutation law, and the file says the kernel, grain and coupling laws wait for those modules.

## 2.9 Toward a reusable API

The chapter's mathematics reduces to a few types and functions. Units are part of each type.

```text
LogH      = Vec3                      # log10 exposure per layer, grey card = 0
Dyes      = Vec3                      # dye amounts in units of the unit dye spectra
Spectrum  = Float[81]                 # 380–780 nm, 5 nm; NaN must be given a meaning (opaque or zero)
Curve     : { at(x), slope(x), inverse(y), shift(dx), stretch(g) }    # monotone, LogH → dye amount
expose(scene: Spectrum, sens: Spectrum[3], kappa: Vec3) -> LogH
couple(u: LogH, M: Mat3, f: Curve[3], f0: Curve[3]) -> Dyes         # f0 from f so neutrals reproduce
convolve(E: Image<linear exposure>, K: Kernel) -> Image<linear exposure>
grain(d: Image<Dyes>, area_um2, dmax, uniformity, rng) -> Image<Dyes>     # mean-preserving
spectral(c: Dyes, eps: Spectrum[3], base: Spectrum) -> Spectrum<density>
printExposure(D: Spectrum, lamp: Spectrum, filters: Spectrum, paperSens: Spectrum[3]) -> LogH
lights(x: LogH, l: LogH) -> LogH                                     # x + l, the only way to balance
view(R: Spectrum<reflectance>, light: Spectrum, flare: Fraction) -> XYZ
display(X: XYZ, white: XYZ, compress: Knee) -> RGB                   # the knee is the last colour step
```

Three laws make good unit tests because each guards a mistake this chapter measured:

- For any negative spectrum DD and lights ℓ\\ell: `lights(printExposure(D, …, paperSens), l)` equals `printExposure` with each `paperSens[k]` multiplied by 10ℓk10^{\\ell_k}, to rounding; and `lights` with a density argument is a type error.
- For any kernel KK of unit weight and exposure image E>0E > 0: log⁡10(K∗E)≥K∗log⁡10E\\log\_{10}(K * E) \\ge K * \\log\_{10} E pointwise, with equality on uniform areas; a halation stage that fails this was applied in the log domain.
- For every neutral tt: `couple(t·1)` equals f(t)f(t) within the table's interpolation error, and for any uu the result is a non-negative dye amount.

## Code in this chapter

| module | what it computes | section |
| --- | --- | --- |
| `chromogen/src/stock.js` | stocks from spektrafilm profiles; `Curve` (table, inverse, slope, shift, gamma); `parametric`; push heuristic | 2.2 |
| `chromogen/src/print.js` | `Lights` in log H and points; paper exposure, grey-patch balance, single-pass viewing; LATD | 2.6, 2.7 |
| `chromogen/src/colour.js` | CIELAB, CIEDE2000, Bradford adaptation, sRGB matrix and encoding | 2.7 |
| `chromogen/src/pipe.js` | typed stages and pipelines, the two-table print with lights between, integrate-to-grey | 2.1, 2.6, 2.8 |
| `chromogen/src/laws.js` | laws as values, seeded checking, counterexample shrinking | 2.8 |
| `chromogen/src/suite.js` | the eight shipped laws | 2.8 |
| `studio-app/src/params.js` | all lights as log-H offsets, `paperX`, flare and gain, halation and grain amounts | 2.4–2.7 |
| `model/parametric.py` | the two-softplus characteristic curve (used only by tests) | 2.2 |
| `model/density_curves.py` | curve interpolation with a gamma factor about log H = 0; sublayer lookup | 2.2, 2.5 |
| `model/couplers.py` | DIR matrix, pre-corrected curves f0f^0, inhibitor with diffusion | 2.3 |
| `model/develop.py` | normalise curves, develop, couple, grain; dye amounts to spectral density | 2.2, 2.3, 2.6 |
| `model/diffusion.py` | scatter and halation kernels, diffusion filters, unsharp mask | 2.4 |
| `model/grain.py` | Poisson–binomial grain per layer and sublayer | 2.5 |
| `model/glare.py` | lognormal viewing glare added in XYZ | 2.7 |
| `model/color_filters.py` | dichroic CC filters, heat filter, band-pass, `color_enlarger` | 2.6 |
| `model/illuminants.py` | blackbody, TH-KG3 lamp, standard illuminants, mean-1 normalisation | 2.6 |
| `model/stocks.py` | the list of 20 films and 8 papers | 2.2 |
| `runtime/stages/filming.py` | spectral exposure, blurs and halation in linear light, log, develop | 2.1, 2.4 |
| `runtime/stages/printing.py` | enlarger exposure, mid-grey normalisation, preflash, paper develop | 2.6 |
| `runtime/stages/scanning.py` | reflectance, XYZ, glare, RGB, output compression, unsharp mask | 2.7 |
| `runtime/pipeline.py` | the topology of nodes and the stage objects | 2.1 |
| `runtime/process.py` | `Simulator`, `simulate`, legacy wrappers | 2.1 |
| `runtime/topology.py` | taps, nodes, the dispatcher | 2.1 |
| `runtime/params_builder.py` | DIR matrices, halation presets, neutral filters, preview and LUT modes | 2.3, 2.4, 2.6, 2.8 |
| `runtime/services/filter_enlarger_source.py` | neutral filter pack plus user and preflash shifts | 2.6 |
| `runtime/services/color_reference.py` | black and white levels as a linear map in YY | 2.7 |
| `utils/gamut_compression.py` | Reinhard knee; input xyxy and output CAM16-UCS compression | 2.7 |
| `utils/autoexposure.py` | metering modes to an exposure shift in stops | 2.1 |
| `utils/morph_curves.py` | the paper's three-CDF curves and their gamma morph | 2.6 |

## Exercises

1. With the fitted magenta curve (γ=0.501\\gamma = 0.501, x0=−1.41x_0 = -1.41, D=1.79D = 1.79, t=0.34t = 0.34, s=0.45s = 0.45) compute f(0)f(0) and f′(0)f'(0) by hand and compare them with the table's 0.704 and 0.494. Which parameter would you change to match the slope, and what does it cost elsewhere?
2. Use J(0)J(0) from section 2.3 to predict the three dye changes for a red-only exposure increase of one stop at the grey card, and compare them with the uncoupled curves. Which colour does the magenta change push the print towards?
3. For a single-layer grain model with u=0u = 0 and Dmax⁡=2.2D\_{\\max} = 2.2, find the crystal area that gives an RMS granularity of 10 at D=1D = 1 through 48 µm, and the pixel standard deviation that this implies for 5 µm pixels.
4. With the kernel of `halation.py`, find the bright-side log exposure at which the halo 100 µm into a dark side at −1.0 log H reaches the grey card's cyan dye amount of 0.687, for each antihalation preset.
5. Project: add two laws to Chromogen's `suite.js`, one that the paper exposure with lights equals the exposure without lights plus the lights (to 10−1210^{-12}), and a replacement for `channels.rebate.zero` that compares a rebate read through one scanner with the stock's base read through another, so that it can fail.

## Sketches in this chapter

4 sketches; choose one from the menu. Drag the parameters, or open the source and edit it: edits stay in this browser.

## Key points

- The forward model is a composition of nine typed maps, and a stage applied to the wrong type (a density where a log exposure belongs, an exposure blurred after its logarithm) gives a plausible but wrong image.
- spektrafilm's parametric curve is a broken line with softplus corners; its γ\\gamma is the slope of the straight part, while a tabulated curve's local slope can differ from it by 14 % at the grey card.
- DIR coupling is a loss of log exposure computed from density, applied before a pre-corrected curve; its Jacobian is Hanson and Horton's gamma matrix, with negative off-diagonals that vanish in the toe.
- A density matrix after the curve can match the coupled model at one point but creates negative dye where the receiving layer has no slope.
- Scatter and halation are normalised convolutions of linear exposure; applied to log exposure or density they lose the halo, because the logarithm is concave.
- spektrafilm's grain is a scaled Poisson count with mean DD and variance (Dmax⁡/N)D(1−uD/Dmax⁡)(D\_{\\max}/N)D(1 - uD/D\_{\\max}), which obeys Selwyn's law at the pixel; its RMS at 48 µm changes by 6 % between 1 and 4 µm pixels while its pixel noise changes by a factor of 2.5.
- Printer lights are shifts of paper log exposure that factor out of the spectral sum, which lets an implementation tabulate the negative once and apply lights per pixel; filters are only approximately shifts.
- spektrafilm treats missing spectral data as opaque and Chromogen as transparent, a 0.18 log H difference in the red printing layer for Portra 400 on Portra Endura.
- A densitometer, a viewer under room light and Saunderson's surface model give different blacks for the same print (2.37, 2.09 with the Studio's default flare, 1.35 with k1k_1), and the surface model makes thin dye layers count up to five times.
- A soft knee guarantees a gamut only if nothing nonlinear or amplifying follows it.

## Further reading

- Hunt, *The Reproduction of Colour*, 6th ed., 13.9–13.10 (pp. 201–205): inter-reflections in the image layer, the 38.6 % first escape, and the measured versus seen black.
- Hunt, 16.7 (pp. 265–266): integrating to grey, the balance strategy behind `autoLights`.
- Giorgianni and Madden, *Digital Color Management*, 2nd ed., App. E (pp. 351–353): viewing flare on the grayscale and on colours, with a worked example.
- US 6,633,408 (Rozzi, 2003), cols. 15–16: the paper model with C-log E curves, a double pass and Saunderson's correction.
- Hanson and Horton, "Subtractive color reproduction: interimage effects", *JOSA* 42 (1952), Eq. 1: dyes as linear functions of all three exposure densities.
- Dainty and Shaw, *Image Science* (1974), ch. 2, p. 58: Selwyn's law, G=Aσ2G = A\\sigma^2 and the Selwyn coefficient.
- James, *The Theory of the Photographic Process*, 4th ed., ch. 21, pp. 620–621: the scanning aperture, magnification and graininess (Eq. 21.80).
- Vitale, *Film Grain, Resolution and Fundamental Film Particles* (2007), p. 11: RMS granularity at 48 µm and typical values.
- Newson, Faraj, Delon and Galerne, "Realistic film grain rendering", *IPOL* (2017): the Boolean grain model rendered at any resolution.
- *Colour Negatives from First Principles*, chapters 4, 6, 7 and 10: the photography and chemistry behind the curves, interimage effects, image structure and the print.

3

### Inversion: from a scan back to dyes

The scanner as a forward model: channel responsivities P_k(λ) = light(λ) × filter × sensor, additive flare, the flat field (a division in sensor coordinates, reduced to a coarse grid, smoothed with \[1 2 1\], normalised and floored, as studio-app/src/source.js does), and Rozzi's alternative scanner model (Gaussian filters, gain–offset–gamma, US 6,633,408 cols.

A scanner gives three numbers per pixel; the negative holds three dye amounts on a known base, and every later stage of an inverter (the inverse characteristic curves, the grey balance, the print) starts from those amounts. This chapter writes the scanner as a forward model, inverts it pixel by pixel as a bounded nonlinear least-squares problem, and treats the pixels it cannot invert as evidence rather than failure. On the Gold 200 frame about a fifth of the pixels (19.3 % in the Studio's statistics) have no dye amounts that reproduce them, and almost none of those (0.05 %) is a colour the film's dyes cannot make: the rest is film at or below its base, partly because the frame was scanned under uneven light. By the end of the chapter you can write the solver Chromogen uses, say why it stops where it does, make it five to seven times faster on the pixels that matter least, tell blank film from a bad scan from a wrong profile, and put the grey balance in the one place where it stays neutral at every density.

## 3.1 The scanner as a forward model

An inverter needs the map it inverts written down. A scanner reads a piece of film of spectral density D(λ)D(\\lambda) through three channels, and channel kk has a **responsivity** Pk(λ)P_k(\\lambda): the product of everything between the lamp and the number,

Pk(λ)=Sk(λ) Fk(λ) Qk(λ), P_k(\\lambda) = S_k(\\lambda)\\,F_k(\\lambda)\\,Q_k(\\lambda),

the light source, the filters and optics, and the sensor's sensitivity. Giorgianni and Madden write the same product with separate mirror and lens terms (App. B, Eq. B.4, p. 335), and DeCaro and Shafer's scanner patent calls it the scanner's spectral sensitivity, a combined function of the illumination and the sensor (US 5,982,957, col. 3). For a camera over a white LED, SS is one spectrum and the QkQ_k are the camera's three curves. For a narrowband scanner each channel is a separate exposure under one LED (sequential capture), so SkS_k is that LED. Chromogen builds exactly this product (`channels.js`, `scanner`) and scales each PkP_k to sum to 1, so that clear light reads zero. The **scanner density** of channel kk is then

Dk=−log⁡10∑λPk(λ) 10−D(λ),D(λ)=b(λ)+∑jcj εj(λ), D_k = -\\log\_{10}\\sum\_\\lambda P_k(\\lambda)\\,10^{-D(\\lambda)}, \\qquad D(\\lambda) = b(\\lambda) + \\sum_j c_j\\,\\varepsilon_j(\\lambda),

with bb the base and εj\\varepsilon_j the stock's unit dye spectra ([Chapter 1](#ch-1)). Together the two equations are the **forward model** D(c)\\mathbf D(\\mathbf c): three dye amounts in, three scanner densities out. A real scan reaches this model through three corrections, which the Studio makes in `source.js`.

**From counts to transmittance.** A raw value is linear in light once the black level is subtracted. The Studio's sample stores the mean of each 6 × 6 X-Trans block as a 16-bit code uu, and `loadSample` recovers the counts as u/16−2u/16 - 2, floors them at 0.05 and divides by 4,000. Dividing by the rebate's value then gives densities relative to unexposed film, Dk=−log⁡10(Tk/Tk,reb)D_k = -\\log\_{10}(T_k/T\_{k,\\text{reb}}), and adding the stock's own base reading Dbase,kD\_{\\text{base},k} restores the absolute scale the forward model expects. That step assumes the rebate is the stock's base, and `program.js` checks it: if the two differ by more than 0.02 D in any channel it warns that the stock or the flat field is wrong. `decode.js` delivers the stored values untouched: it parses 16-bit PNG and TIFF itself so that all 16 bits survive the browser, refuses camera raw files with instructions for a linear export, and leaves the transfer (linear, sRGB or gamma 2.2) to `Source.region`.

**Flare.** Light scattered inside the lens and the holder adds a fraction ff of the open-gate signal to every pixel, so the camera records T+fT + f where the film transmits TT. Above the rebate this reads

Dk′=−log⁡10Tk+fTk,reb+f. D_k' = -\\log\_{10}\\frac{T_k + f}{T\_{k,\\text{reb}} + f} .

The error grows with density and is largest where the rebate transmits least, in blue, behind the orange mask. With f=0.5 %f = 0.5\\,\\%, the value written in Chromogen's example scanner documents, the running example's white patch falls from 1.429 to 1.172 D above the rebate in the narrowband blue channel; solved and passed through the inverse curves, its blue layer then reads 0.38 log H too little exposure, more than a stop, and its red layer 0.07 (`m11_wedge.js`). The engine does not model this. `lang/SPEC.md` lists `flare` among a scanner's fields and the example documents set it, but `program.js` (`loadScanner`) reads only the light, the camera and the capture mode, so the value is silently ignored. Section 3.7 measures ff with a neutral wedge.

**Uneven light.** No lamp and lens light the gate evenly, so the recorded value is Lk(x) Tk(x)L_k(\\mathbf x)\\,T_k(\\mathbf x), with an illumination LL that varies across the sensor. A **flat field** is a capture of LL alone, with no film in the gate, and the correction is a division. How the division is done decides whether it helps, and `flatGrid` makes four choices:

```js
// source.js flatGrid, condensed: the illumination on a coarse grid in sensor coordinates
export function flatGrid(flat, transfer, long = 96) {
  // 1. average the flat over gw × gh cells (96 along the long side for Smooth, 512 for Fine), then apply the transfer
  // 2. smooth each channel with [1 2 1]/4 along x, then along y: twice for grids of 200 cells or fewer, once above
  // 3. divide each channel by its mean, and floor the result at 0.05
  // 4. report the fall-off: log10(max / min) over the cells above 0.2, the lit area's range in D
}
```

The division happens in sensor coordinates, before the frame is flipped, rotated or cropped, because the illumination belongs to the sensor, not to the film: `Source.region` maps each output pixel back to the source pixel under its centre and reads the grid there by bilinear interpolation. The grid averages the flat's own noise away (a 1,292 × 863 capture puts about 180 pixels in each of 96 × 64 cells), and two passes of \[1 2 1\]/4 make the five-tap binomial kernel (1, 4, 6, 4, 1)/16, which removes what remains at the scale of a cell. Dividing by the mean leaves the frame's exposure alone, since the rebate is divided by the same grid, and the floor stops the dark border of a film holder from becoming an enormous transmittance. The Studio's test (`test/flat.cjs`) checks the whole path, and the check runs in node as well (`m08_flat.mjs`): multiply the Gold 200 frame by a vignette that falls 0.26 D towards the corners, divide by a flat of the same vignette carrying ±1 % noise, and every density returns to within 0.0006 D of the untouched frame.

**Rozzi's alternative.** Kodak's patent on modelling photographic printing (Rozzi, US 6,633,408) treats the scanner as a closed box whose channels must be inferred. Its forward model integrates the sample spectrum against three filter functions, each a Gaussian with a mean, a width and an amplitude, and passes each integral rr through a tone curve of gain–offset–gamma form, d=(kgr+ko)γd = (k_g r + k_o)^{\\gamma} (cols. 8–10), fitted from a neutral wedge and a 512-patch target (cols. 9–11). Chromogen's channels are instead physical spectra, measured or specified, and its camera is linear because it is read raw. The patent's offset kok_o is where additive flare lives (Section 3.7).

## 3.2 The dye solve as bounded least squares

Given measured densities d\\mathbf d (absolute, after the rebate step), the solve looks for dye amounts with D(c)=d\\mathbf D(\\mathbf c) = \\mathbf d: three equations in three unknowns. Two facts stop this from being a plain root-finding problem. The amounts are physical, so no dye amount is negative and none exceeds what the film can form: c\\mathbf c lies in a box 0≤cj≤cmax⁡0 \\le c_j \\le c\_{\\max} (`solve.js`: `lo = 0`, `hi = 4`, generous against Portra 400's largest amount, 2.16). And d\\mathbf d can lie outside the set of densities the box produces, because of noise, flare or a wrong profile, and then no root exists. Least squares handles both. Define the **residual**

r(c)=D(c)−d,F(c)=∥r(c)∥2=∑krk2, \\mathbf r(\\mathbf c) = \\mathbf D(\\mathbf c) - \\mathbf d, \\qquad F(\\mathbf c) = \\lVert \\mathbf r(\\mathbf c)\\rVert^2 = \\sum_k r_k^2 ,

and minimise FF over the box. Where a root exists the minimum is zero and the minimiser is the root; where none exists the minimiser is the closest density the film can make, and F\\sqrt F says how far away it is, in density units. That number is what Section 3.5 turns into a diagnosis.

**The Jacobian.** The solvers of the next section need the derivatives ∂Dk/∂cj\\partial D_k/\\partial c_j, arranged as a 3 × 3 matrix JJ, the **Jacobian** of the forward model. Write T(λ)=10−D(λ)T(\\lambda) = 10^{-D(\\lambda)} and sk=∑λPkTs_k = \\sum\_\\lambda P_k T. Since ∂T/∂cj=−ln⁡10 εjT\\partial T/\\partial c_j = -\\ln 10\\,\\varepsilon_j T,

Jkj=∂Dk∂cj=−1ln⁡10 1sk ∂sk∂cj=∑λPk T εj∑λPk T=∑λwk(λ) εj(λ),wk=PkT∑λPkT. J\_{kj} = \\frac{\\partial D_k}{\\partial c_j} = -\\frac{1}{\\ln 10}\\,\\frac{1}{s_k}\\,\\frac{\\partial s_k}{\\partial c_j} = \\frac{\\sum\_\\lambda P_k\\,T\\,\\varepsilon_j}{\\sum\_\\lambda P_k\\,T} = \\sum\_\\lambda w_k(\\lambda)\\,\\varepsilon_j(\\lambda), \\qquad w_k = \\frac{P_k T}{\\sum\_\\lambda P_k T} .

The weights wkw_k are the spectrum of the light that actually reaches channel kk's sensor through this piece of film, scaled to sum to 1, so JkjJ\_{kj} is dye jj's unit density averaged under that light. Through a narrow channel wkw_k cannot move, and JJ stays close to the analytical matrix KK of [Chapter 1](#ch-1); through a broad one, added dye shifts wkw_k towards wavelengths the dyes absorb less, and the entries fall as density rises. The closed form agrees with central differences to within 3.8×10−103.8 \\times 10^{-10} on 50 random dye triples for all four channel families the chapter uses (`m01_jacobian.js`). At the running example's grey card, for the white-LED camera,

J=(0.4470.3200.0140.1600.7240.0330.0130.3360.728),K=(0.2530.3300.0130.0360.7480.0320.0070.1180.592). J = \\begin{pmatrix} 0.447 & 0.320 & 0.014 \\\\ 0.160 & 0.724 & 0.033 \\\\ 0.013 & 0.336 & 0.728 \\end{pmatrix}, \\qquad K = \\begin{pmatrix} 0.253 & 0.330 & 0.013 \\\\ 0.036 & 0.748 & 0.032 \\\\ 0.007 & 0.118 & 0.592 \\end{pmatrix} .

KK reads each unit dye alone, a secant taken where broadband channels fail most, and its small red–cyan entry is why the analytical start c0=K−1(d−Dbase)\\mathbf c_0 = K^{-1}(\\mathbf d - \\mathbf D\_{\\text{base}}) overestimates: for the grey card it gives (1.094, 0.797, 1.323) against the true (0.687, 0.704, 0.864). For the narrowband LEDs the same start is within 0.014. `solve.js` clips this start into the box and iterates from there.

The residual and the Jacobian share all their expensive work, the 81 transmittances, so `solve.js` computes both in one pass over the spectrum and allocates nothing inside the loop:

```js
// solve.js evalF, condensed: residual and Jacobian from one pass over the 81 wavelengths
for (let i = 0; i < n; i++) {
  const t = Math.exp(-LN10 * (B[i] + c0 * E0[i] + c1 * E1[i] + c2 * E2[i]));   // T(λ) = 10^−D(λ)
  const w0 = P0[i] * t, w1 = P1[i] * t, w2 = P2[i] * t;                         // P_k T
  s0 += w0; s1 += w1; s2 += w2;                                                 // Σ P_k T
  if (withJ) { a00 += w0 * E0[i]; a01 += w0 * E1[i]; /* … all nine Σ P_k T ε_j */ }
}
r[0] = -Math.log10(s0) - d[0];                    // r_k = D_k(c) − d_k
if (withJ) { J[0] = a00 / s0; J[1] = a01 / s0; /* … J_kj = Σ P_k T ε_j / Σ P_k T */ }
```

**Conditioning.** How much the answer moves when the measurement moves is a property of JJ. Its **singular values** σ1≥σ2≥σ3\\sigma_1 \\ge \\sigma_2 \\ge \\sigma_3, the square roots of the eigenvalues of JTJJ^\\mathsf{T}J, are the largest and smallest factors by which JJ stretches a vector. Near the solution δc≈J−1 δd\\delta\\mathbf c \\approx J^{-1}\\,\\delta\\mathbf d, so a density error is amplified by at most 1/σ31/\\sigma_3, and a small σ3\\sigma_3 means some combination of dyes barely changes the reading. Figure 3.1 maps σ3\\sigma_3 over the cyan–magenta plane at the grey card's yellow. For the narrowband LEDs it stays between 1.087 and 1.143 over the whole cube \[0,2.4\]3\[0, 2.4\]^3, so noise is not amplified at all. For the white-LED camera it is 0.36 at the base and 0.305 at the grey card, and it falls to 0.034 at dense yellow with no cyan or magenta, where a density error can be amplified 29 times. Independent noise of 0.005 D per channel becomes a dye scatter of 0.0145, 0.0089 and 0.0080 at the grey card through the white-LED camera, against 0.0044, 0.0040 and 0.0044 through the LEDs (`m13_misc.js`). `program.js` reports σ3\\sigma_3 with every solve and warns below 0.05; the Studio's table skips it (`sigma: false`).

**Figure 3.1.** Smallest singular value σ3\\sigma_3 of the Jacobian over cyan and magenta amounts, with yellow at the grey card's 0.864, for Portra 400 read by the white-LED camera (left) and by the narrowband LEDs (right), computed with `solve.js`'s closed-form Jacobian and `linalg.minSingular` on a 49 × 49 grid (`fig1_conditioning.js`). The red dot is the grey card. The narrowband solve is equally well conditioned everywhere; the broadband one loses a factor of four towards dense cyan with no magenta (0.071 at the corner). Scanner parts are illustrative (film data: spektrafilm, CC BY-SA 4.0).

**Try it.** Open [the conditioning map](#bench-03-inversion). With `family` on `LEDs`, widen `fwhm` from 20 to 100 nm: the smallest singular value on this slice falls from 1.09 to 0.25 and the noise gain rises from 0.9 to 4.1. Then choose `white LED` and raise `yellow` to 2.4.

## 3.3 Gauss–Newton and Levenberg–Marquardt

Near a guess c\\mathbf c the forward model is close to its tangent, r(c+Δ)≈r+JΔ\\mathbf r(\\mathbf c + \\boldsymbol\\Delta) \\approx \\mathbf r + J\\boldsymbol\\Delta. Minimising the squared length of the tangent's residual, ∥r+JΔ∥2\\lVert \\mathbf r + J\\boldsymbol\\Delta \\rVert^2, over the step Δ\\boldsymbol\\Delta is a linear least-squares problem whose solution satisfies the **normal equations**

A Δ=−g,A=JTJ,g=JTr, A\\,\\boldsymbol\\Delta = -\\mathbf g, \\qquad A = J^\\mathsf{T} J, \\qquad \\mathbf g = J^\\mathsf{T}\\mathbf r ,

where g\\mathbf g is half the gradient of FF. Taking that step and repeating is **Gauss–Newton**. With three channels and three dyes JJ is square, and when it is invertible the step is Newton's method for the equations themselves, JΔ=−rJ\\boldsymbol\\Delta = -\\mathbf r, whose error near a solution roughly squares at every iteration. On the grey card through the white-LED camera the residual goes 0.42, 0.042, 6.4×10−46.4 \\times 10^{-4}, 1.5×10−71.5 \\times 10^{-7} D.

Far from the solution the tangent is a poor model and a full step can overshoot, which matters when JJ is ill-conditioned: a small σ3\\sigma_3 makes A−1A^{-1} large in the direction the data barely constrain. **Levenberg–Marquardt** (LM) adds a damping term,

(A+μD) Δ=−g, (A + \\mu D)\\,\\boldsymbol\\Delta = -\\mathbf g ,

with μ≥0\\mu \\ge 0. As μ→0\\mu \\to 0 the step becomes Gauss–Newton's; as μ\\mu grows it shortens and turns towards −g-\\mathbf g, the direction of steepest descent. Levenberg used D=ID = I; Marquardt used D=diag(A)D = \\mathrm{diag}(A), which makes the damping independent of the units of each unknown. `solve.js` uses both, bii=Aii+μ(1+Aii)b\_{ii} = A\_{ii} + \\mu(1 + A\_{ii}), so that a column of JJ near zero (a dye the channels barely see) still gets damped.

The textbook way to steer μ\\mu is the **gain ratio**, the actual reduction of FF divided by the reduction the tangent model predicted,

ρ=F(c)−F(c+Δ)∥r∥2−∥r+JΔ∥2, \\rho = \\frac{F(\\mathbf c) - F(\\mathbf c + \\boldsymbol\\Delta)}{\\lVert\\mathbf r\\rVert^2 - \\lVert\\mathbf r + J\\boldsymbol\\Delta\\rVert^2} ,

lowering μ\\mu when ρ\\rho is near 1 (the model can be trusted with longer steps) and raising it when ρ\\rho is small or negative (Nocedal and Wright treat LM this way, as a trust-region method). `solve.js` does not compute ρ\\rho. It uses the simpler rule of `linalg.lm`: try the step; if FF fell, accept it and divide μ\\mu by 3 (down to 10−1210^{-12}); if not, multiply μ\\mu by 4 and solve again, up to 12 tries. On the grey card the first accepted step has ρ=0.991\\rho = 0.991 (`m13_misc.js`): where the model is this good, accepting every improvement loses nothing, and the rule needs nothing beyond the residual it already computes.

```js
// solve.js spectral(), the damping loop, condensed (the real code writes the 3 × 3 solve out by cofactors)
for (let tries = 0; tries < 12 && !improved; tries++) {
  const B = [[A00 + mu * (1 + A00), A01, A02], [A01, A11 + mu * (1 + A11), A12], [A02, A12, A22 + mu * (1 + A22)]];
  const step = solve3(B, g), y = x.map((v, k) => clip(v - step[k]));   // (A + μD)⁻¹ g, then into the box
  const F1 = evalF(y, d, false);                                          // residual only
  if (F1 < F) { x = y; mu = Math.max(mu / 3, 1e-12); improved = F - F1 > stall * F; F = evalF(x, d, true); }
  else mu *= 4;
}
// back in the iteration loop: if (!improved) break;   no damped step lowers F, or the last one lowered it too little
```

The loop stops for one of five reasons, and each is a choice about what a pixel deserves. F≤10−12F \\le 10^{-12} (`tolerance`) means the residual is below 10−610^{-6} D, thousands of times below a scanner's noise. 50 iterations (`maxIterations`) caps the work on pixels that converge slowly. Twelve failed tries means no step in the damped family lowers FF, which happens at a minimum, often one on a bound. `stall` (0 by default) stops when an accepted step lowered FF by less than that fraction of FF, and `gtol` (only with the active set of Section 3.4) stops when the gradient of the free dyes is below it.

A complete trace on the grey card, white-LED camera, solved as the Studio solves it (`m13_misc.js`, through a port of `spectral()` that returns bitwise the same results as `solve.js` on 4,000 random inputs, `lmtrace.js`):

```text
it  c (cyan, magenta, yellow)   |r| (D)     mu        tries
0   1.0936  0.7974  1.3228      4.24e-1     1.0e-3    start: K⁻¹(d − D_base), clipped
1   0.6734  0.7010  0.8136      3.94e-2     3.3e-4    1
2   0.6865  0.7044  0.8628      5.08e-4     1.1e-4    1
3   0.6865  0.7044  0.8635      3.09e-7     3.7e-5    1     stop: |r|² ≤ 1e-12
true 0.6865  0.7044  0.8635
```

Every step is accepted at the first try, and each costs two passes over the spectrum (the trial, then the residual with its Jacobian), seven passes in all. Rozzi's patent searches the same space with Powell's method or BFGS under bounds, on the Euclidean distance between predicted and measured code values (US 6,633,408, col. 7); those methods see only the scalar distance, LM the residual vector and its derivative. On this grey card the long book measured 509 forward evaluations for Powell's method and 148 for bounded BFGS (an earlier measurement, its chapter 9).

## 3.4 Bounds and the active set

The simplest way to keep the amounts in the box is to compute the step as if there were no box and clip the result, c←clip(c+Δ)\\mathbf c \\leftarrow \\mathrm{clip}(\\mathbf c + \\boldsymbol\\Delta), which is what `solve.js` does by default. Inside the box clipping never acts. It fails when the best answer lies on a bound, and that is common: any pixel the film cannot have made has its closest reachable point on the surface of the box, usually with a dye at zero. There the unconstrained step pushes the bounded dye further out, clipping cancels that component, and the other two components are wrong as well, because they were computed on the assumption that the first dye would move. The solve creeps along the bound, a little per iteration, until the cap.

Take a shadow pixel that reads 0.02, 0.35 and 0.45 D above the rebate through the white-LED camera: too little red for the magenta and yellow its green and blue demand, so the best answer has no cyan. Figure 3.2 (right) follows three solvers on it. Undamped Gauss–Newton repeats the same clipped step and stays 0.033 D above the best residual for all 50 iterations. LM, with its damping growing after each failed try, lowers the residual from 0.139 to 0.1066 D and is still 1.4×10−41.4 \\times 10^{-4} above the minimum when the cap stops it; run on, it needs 58 iterations to get within 10−410^{-4} and 492 to get within 10−610^{-6}.

The fix uses what a minimum on a box looks like. At the constrained minimum each dye is either free, with zero gradient, or held at a bound with the gradient pushing outwards: gj≥0g_j \\ge 0 at cj=0c_j = 0 (lowering FF would need a negative amount) and gj≤0g_j \\le 0 at cj=cmax⁡c_j = c\_{\\max}. So at every iteration the solver marks a dye as **held** if it sits on a bound and its gradient points out of the box,

heldj ⟺ (cj=0 and gj>0) or (cj=cmax⁡ and gj\<0), \\text{held}\_j \\iff (c_j = 0 \\text{ and } g_j > 0) \\text{ or } (c_j = c\_{\\max} \\text{ and } g_j \< 0) ,

and solves the damped normal equations for the free dyes alone. This is a **projected Newton step** (Bertsekas, 1982), and in the 3 × 3 system it costs three lines: a held dye's row and column are replaced by the identity and its gradient by zero, which leaves it where it is, and the iteration stops when the largest gradient of a free dye falls below `gtol`.

```js
// solve.js, with activeSet: hold the dyes a bound is holding, stop on the projected gradient
a0 = (x0 <= lo && g0 > 0) || (x0 >= hi && g0 < 0);   // and likewise a1, a2
const converged = Math.max(a0 ? 0 : Math.abs(g0), a1 ? 0 : Math.abs(g1), a2 ? 0 : Math.abs(g2)) < gtol;   // then stop
if (a0) g0 = 0;                                        // no push on a held dye
if (a0) { b00 = 1; A01 = 0; A02 = 0; }                 // its row and column of A + μD become the identity
```

On the shadow pixel the active-set solve holds cyan from the first iteration and reaches the constrained minimum, ∥r∥∗=0.10646\\lVert\\mathbf r\\rVert^\* = 0.10646 D, in four iterations and nine passes over the spectrum, against LM's 146 passes that do not get there. On pixels with a root the held set stays empty and the two solvers are identical, step for step (Figure 3.2, left).

**Figure 3.2.** Residual against iteration for three solvers on Portra 400, from a port of `solve.js` that reproduces it bitwise (`fig2_convergence.js`). Left: the grey card through the white-LED camera (undamped Gauss–Newton dotted, `solve.js`'s LM solid) and through the narrowband LEDs (LM dashed); the active-set solve is identical to LM on these pixels; the grey line is the stopping tolerance 10−610^{-6} D. Right: a pixel 0.02, 0.35, 0.45 D above the rebate through the white-LED camera, whose best answer has no cyan, drawn as the excess over the constrained minimum ∥r∥∗=0.10646\\lVert\\mathbf r\\rVert^\* = 0.10646 D: Gauss–Newton stalls, LM creeps to the 50-iteration cap, the active-set step (red) reaches the minimum in four iterations. Scanner parts are illustrative (film data: spektrafilm, CC BY-SA 4.0).

The Studio solves every node of a 33³ table this way (`model.js`, `SOLVE_OPTS = { activeSet: true, gtol: 1e-9 }`; [Chapter 4](#ch-4) explains the table). Rebuilding the table both ways on one core of the machine this book was built on (`m03_table.js`, best of three):

| scanner, film | plain LM | active set | mean iterations | nodes at the cap | unreachable nodes |
| --- | --- | --- | --- | --- | --- |
| X-T5 LEDs, Gold 200 | 1.64 s | 0.24 s | 13.9 → 2.3 | 8,885 → 0 | 24.9 % |
| book's LEDs, Portra 400 | 1.60 s | 0.27 s | 13.9 → 2.2 | 8,906 → 0 | 24.9 % |
| Status M, Portra 400 | 1.60 s | 0.27 s | 14.1 → 2.5 | 8,908 → 0 | 24.9 % |
| white LED, Portra 400 | 2.67 s | 0.49 s | 23.2 → 5.1 | 15,040 → 15 | 39.7 % |

The speed-up is 5.4 to 6.8 times, and it comes from the quarter of the table that lies outside the reachable set: before the change, the nodes stopped by the cap did 88 to 90 % of all iterations while the median node needed two. The Studio's own write-up measured 1.62 s → 0.33 s for the first row on another machine (`11-speed.md`); times move with the machine, the iteration counts do not.

Faster is half the claim; the other half is "never worse". Counting differences larger than the solver's own tolerance of 10−610^{-6} D, the active-set residual is lower at 7,199, 2,481, 4,583 and 8,176 nodes and higher at exactly one: an unreachable white-LED node whose residual rises from 0.12523 to 0.12524 D because the plain solve, stopped by the cap, had happened to creep slightly further (`m03c_worse.js`). A strict comparison also finds 40 nodes whose residual rises by less than the tolerance, which nobody can see. In the three narrowband cases most improvements are below 10−510^{-5} D and only 15 nodes in all improve by more than 10−410^{-4} D, so there the active set buys speed alone. For the white-LED camera it also buys accuracy: 4,611 nodes improve by more than 10−410^{-4} D, 146 nodes that are reachable by either solver move by more than 0.01 in dye amount, by up to 0.16 (every one of them a node the cap had stopped), and the 27 nodes that the plain solve left between 0.0100 and 0.0127 D now fall below the 0.01 D threshold of Section 3.5.

A cheaper fix fails, and how it fails is instructive. Setting `stall = 0.001` (stop when an accepted step improves FF by less than 0.1 %) makes the X-T5 table 6.7 times faster and moves no reachable node by more than 2.3×10−52.3 \\times 10^{-5}. On the white-LED camera, where progress is slow far from the answer because JJ is ill-conditioned, it stops reachable nodes early, moves them by up to 0.66 and flips 34 across the threshold (`m14_stall_stock.js`). A stopping rule that tests the rate of progress cannot tell slow convergence from arrival; a rule that tests the projected gradient can.

**Try it.** Open [the LM path](#bench-03-inversion). It draws the residual over the cyan–magenta plane for one pixel, with the bound at zero cyan, and the iterates of Gauss–Newton, LM and the active-set solve. Set `red` to 0.02 and watch LM creep along the bound while the active set reaches it in a few steps; then raise `red` to 0.25, which puts the answer inside the box, and the three paths coincide.

## 3.5 Reachability and the three classes

The densities a film can produce form its **reachable set**, the image of the dye box under the forward model, R={D(c):0≤c≤cmax⁡}\\mathcal R = \\{\\mathbf D(\\mathbf c) : \\mathbf 0 \\le \\mathbf c \\le \\mathbf c\_{\\max}\\}: a curved solid in the space of three densities. Near the base the forward model is close to its tangent, D(c)≈Dbase+J(0) c\\mathbf D(\\mathbf c) \\approx \\mathbf D\_{\\text{base}} + J(\\mathbf 0)\\,\\mathbf c, so the corner of R\\mathcal R at the base is a cone spanned by the columns of J(0)J(\\mathbf 0); for the narrowband LEDs, whose JJ is nearly diagonal, it is close to the octant of densities that are all at or above the rebate. A pixel inside R\\mathcal R has an exact solution; a pixel outside has a least-squares answer on the surface of the box and a residual equal to its distance from R\\mathcal R. The Studio stores that residual beside the dye amounts in its table and calls a pixel **unreachable** when it exceeds 0.01 D (`render.js`). A quarter of the Studio's table lies outside R\\mathcal R for every narrowband family, and 39.7 % for the white-LED camera.

A residual says that a pixel does not fit; it does not say why. On a real scan there are three reasons, and only one is the model's fault:

- **Blank film.** Some layer recorded nothing, so the pixel reads at the base in that channel, and noise pushes it below zero half the time.
- **Below base.** A channel reads lighter than the rebate by more than its noise explains, which unexposed film cannot do: the light was uneven or the rebate was picked badly.
- **Out of gamut.** Every layer has formed dye and still no dye amounts fit: the scanner profile or the stock is wrong.

`classify` in `source.js` separates them by putting each channel's density above the rebate in units of that channel's noise, zk=Dk/σkz_k = D_k/\\sigma_k, and testing the smallest:

```js
// source.js classify: the order of the tests matters; below base wins over blank, both over gamut
export const Z_NOISE = 3;
export function classify(T, Treb, sig, residual) {
  const D = [0, 1, 2].map((k) => -Math.log10(Math.max(T[k], 1e-6) / Treb[k])), z = D.map((v, k) => v / sig[k]), zmin = Math.min(...z);
  const cls = zmin < -Z_NOISE ? 'below' : zmin <= Z_NOISE ? 'blank' : residual > 0.01 ? 'gamut' : 'ok';
  return { cls, D, z, layers: [0, 1, 2].filter((k) => (cls === 'below' ? z[k] < -Z_NOISE : Math.abs(z[k]) <= Z_NOISE)) };
}
```

The noise σk\\sigma_k is measured on the rebate box, from each pixel's departure from the mean of its 9 × 9 neighbourhood (the estimator of [Chapter 1](#ch-1)), and it depends on the resolution: averaging pixels averages noise. On the Gold 200 frame it is 0.0090, 0.0069 and 0.0122 D at the full 1,090 × 754 size and 0.0043, 0.0033 and 0.0057 D at the 640-pixel size where the Studio computes its frame statistics. With Z=3Z = 3, a pixel is blank if its weakest channel is within about 0.02–0.04 D of the rebate at full size.

The Studio's own book reports 12.6 % blank film, 9.7 % below base and no pixel out of gamut on this frame, with 19.3 % flagged unreachable. Recomputing every pixel with the Studio's code (`m05_classes.mjs`: `source.js` loads the sample with the Studio's settings, the residual comes either from a rebuilt 33³ table read by trilinear interpolation, as the renderer reads it, or from an exact solve of every pixel):

| size | blank | below base | out of gamut | unreachable, table | unreachable, exact |
| --- | --- | --- | --- | --- | --- |
| 640 × 443 (Studio statistics) | 12.6 % | 9.7 % | 0.05 % | 19.3 % | 13.7 % |
| 1,090 × 754 (full size) | 21.5 % | 7.2 % | 0 | 21.8 % | 17.1 % |

Three things in the table matter more than any one number. First, a percentage means nothing without its size: the same frame is 19.3 % unreachable at 640 pixels and 21.8 % at full size, and 12.6 % blank at one size and 21.5 % at the other. Second, the table overstates unreachability by about five points at both sizes: a cell that straddles the edge of R\\mathcal R interpolates between zero and non-zero residuals, so pixels just inside the edge inherit a residual above 0.01 D. Third, blank and below base trade places with resolution. Noise halves at the smaller size, the ±3σ band narrows, and pixels whose shadows sit a few hundredths of a density below the rebate leave "blank" for "below base". A random error would shrink with averaging; this one does not, so it is systematic. Figure 3.4 (left) shows the trade as ZZ varies.

**Figure 3.3.** A slice through scanner-density space for the X-T5 profile and Gold 200 at a green density of 0.10 D above the rebate. The black line is the edge of the reachable slice, where cyan or yellow is zero (`fig3_reach.mjs`); the dashed lines are z=±3z = \\pm 3 for red and blue at full size, the light bands blank film and the darker band below base. Dots are 800 of the 45,386 Gold 200 pixels whose green lies within 0.08–0.12 D, red where the exact solve leaves a residual above 0.01 D. Every red dot lies in a blank or below-base band; none is out of gamut. The edge's corner sits at blue +0.008 D, not zero, because 0.08 units of magenta absorb a little blue (film data: spektrafilm, CC BY-SA 4.0).

Figure 3.3 shows where the unreachable pixels of one slice lie: all in the bands, below the reachable edge in blue. A pixel truly at base reads Dk∼N(0,σk)D_k \\sim N(0, \\sigma_k), so all three channels are non-negative with probability 1/8, and the Studio's book concludes that "about seven in eight" such pixels are flagged. Simulating 20,000 of them with the Gold 200 noise gives 12.8 % with no negative channel but only 37.7 % flagged at full size and 6.2 % at 640 pixels (`m07_zsweep.mjs`): a channel 0.005 D below the rebate leaves a residual near 0.005 D, under the threshold. Seven in eight holds only for noise well above 0.01 D (81.8 % at σ=0.05\\sigma = 0.05 D).

Where the below-base pixels are says what caused them. The 1st percentile of each channel's density across the frame, in 25-pixel bands, is the frame's shadow floor (Figure 3.4, right). Next to the rebate it is −0.022, −0.017 and −0.031 D, within 0.003 D of where noise alone would put it (−2.33σk-2.33\\sigma_k). Towards the middle of the frame it falls to −0.053, −0.060 and −0.069 D: 0.03 to 0.04 D below what noise explains. The rebate strip itself is not uniform either: it is 0.021 D denser at its top than its mean and 0.007 D lighter in its lower half. Both are what light stronger in the middle of the gate than at its edge would do, and no flat field was captured with this frame. The synthetic test of Section 3.1 shows what one would buy: a vignette of 0.26 D raises below base from 9.7 % to 22.6 % at the Studio's size, and dividing by its flat restores 12.6 % and 9.7 % exactly (`m08_flat.mjs`).

**Figure 3.4.** The Gold 200 frame's classes. Left: blank film (solid) and below base (dashed) as a share of the frame against the threshold ZZ of `classify`, at full size (black) and at the Studio's 640-pixel size (grey), from exact residuals (`m07_zsweep.mjs`). Right: the 1st percentile of density above the rebate across the frame, red solid, green dashed, blue dotted, in 25-pixel bands from the edge next to the rebate (`fig4_classes.mjs`); the grey band is where noise alone would put it. The floor near the rebate is noise; 300 to 550 pixels in, it is 0.03 to 0.04 D lower, a sign of uneven light. Beyond 550 pixels the frame has no deep shadows and the percentile measures picture content.

**Try it.** Open [the reachable classes](#bench-03-inversion). It shows the slice of Figure 3.3 with its noise bands and a sample of Gold 200 pixels, each drawn by its class. Move `Z` from 3 to 1.5 and watch rings (blank film) turn into squares (below base) while the red ones, the unreachable pixels, stay where they are; then set `correction` to 0.03, which adds back the 0.03 D the middle of the frame seems to lack, and watch the unreachable share fall from 20 % to under 6 %.

## 3.6 Grey balance belongs in log exposure

Once the dye amounts are known, the print needs **printer lights**: one log-exposure offset LkL_k per paper layer, set so that something in the frame prints neutral. In `print.js` the paper's log exposure in layer kk is

xk=log⁡10∑λS(λ) T(λ) sk(λ)+Lk=Ck−PDk+Lk, x_k = \\log\_{10}\\sum\_\\lambda S(\\lambda)\\,T(\\lambda)\\,s_k(\\lambda) + L_k = C_k - \\mathrm{PD}\_k + L_k ,

with SS the enlarger lamp, sks_k the paper's sensitivity, CkC_k the clear-gate exposure and PDk\\mathrm{PD}\_k the negative's **printing density** ([Chapter 2](#ch-2)). Printer lights therefore shift each paper layer's exposure, a horizontal move along the paper's characteristic curve, and the paper's curve then turns exposure into dye.

The alternative is tempting because it looks equivalent: compute the print, then add a constant density per channel until the grey card is neutral, which is what a filter laid over the print would do. Hunt gives the reason it is not equivalent (14.17). A light of the wrong colour at capture moves one layer's curve along the log-exposure axis; a correcting filter at the camera moves it back along the same axis and restores the neutral scale at every density, while a filter over the transparency moves the curve along the density axis instead. The two moves agree only where the curve is straight. In the toe and the shoulder the vertical move over-corrects at low densities and under-corrects at high ones, and a grey scale runs from one colour, through grey, to the opposite colour.

The running example measures the difference (`m09_balance.js`). A grey scale is shot under 3,800 K on Portra 400, which is balanced for 5,500 K: the layers' log exposures shift by +0.166, +0.021 and −0.187 (mean removed). It is corrected at the grey card in two ways and compared, step by step, with the same scale shot under 5,500 K and printed with the aim lights (Figure 3.5, left). Printer lights fitted on the grey card move by +0.085, +0.002 and −0.079 log H and leave at most 2.4 CIEDE2000 units of error anywhere on the scale, towards the film's toe, where the cast moved the layers by different amounts of density. A density shift fitted on the same grey card leaves up to 14.6 units, and from 1 log H above the grey card up to paper white the error stays near 14: the shift tints the paper's white, which no light can do. Chromogen makes the wrong choice hard to write: `Lights.shift` accepts log exposures only and refuses a density with an error that cites Hunt 14.17.

Printer lights are not exact either. The cast lives in the film's log exposure, before the film's curve, and the curve turns a constant shift there into a change of printing density that varies with density wherever the curve bends (Hunt 16.13 calls the remedy slope control). The exact correction would shift each layer's log exposure, which means inverting the film's curves first; `program.js` computes those exposures (level L2) but balances, as an optical printer does, with lights.

**Figure 3.5.** Grey balance on Portra 400 printed on Portra Endura (3,200 K lamp, 5,000 K viewing), from `m09_balance.js` and `fig5_balance.js`. Left: CIEDE2000 error of a grey scale shot under 3,800 K, against the same scale shot under 5,500 K, when uncorrected (grey dotted), corrected by printer lights fitted on the grey card (red), and corrected by a constant paper-dye density fitted on the same card (dashed). Right: chroma of the printed grey card after integrate-to-grey with partial correction α\\alpha, for the six-patch running frame and for a frame of mostly foliage, without a cast (grey) and with a 4,300 K cast (black). Film data: spektrafilm, CC BY-SA 4.0.

How should the lights be chosen when nothing in the frame is known to be grey? **Integrate-to-grey** prints each negative so that the whole picture averages to grey (Hunt 16.7, after Evans): measure the frame's **large-area transmission density** (LATD), the density of its mean transmittance in each of the paper's bands (`print.js`, `latd`), and set each layer's exposure from it. Full correction removes casts from the light, the film and the processing, and also any colour the scene itself has on average, so a frame dominated by green foliage prints magenta, which Hunt calls colour failure. `program.js` corrects partially:

```js
// program.js integrate(alpha): the density part in full, the colour part by alpha
const integrate = (alpha = 0.75) => (fr) => {
  const delta = fr.latd.map((v, k) => v - aimLatd[k]), mean = (delta[0] + delta[1] + delta[2]) / 3;
  return new Lights(aimLights.values.map((a, k) => a + mean + alpha * (delta[k] - mean)));
};
```

The mean of the three differences is overall density, an exposure error, and is corrected in full; the departures from the mean are colour, corrected by α\\alpha. The default 0.75 is a heuristic, and the right panel of Figure 3.5 shows why some value between 0 and 1 is needed. Without a cast, α=0\\alpha = 0 is right (grey card chroma 0.25 for the six patches) and full correction gives the foliage frame a chroma of 19.4. With a 4,300 K cast, the six-patch frame is best near 0.75 (chroma 3.5, against 10.5 at α=0\\alpha = 0) and the foliage frame near 0.25. (`program.js` cites Hunt 16.10 for colour failure; in the sixth edition 16.10 is "Subtractive printers", and colour failure is discussed in 16.7.)

Motion-picture labs express the same lights as **printer points**, integers from 1 to 50 with one point equal to 0.025 log E at the print (US 6,985,253, col. 4). The patent converts a difference of points to code values by multiplying it by 0.025 and then by 12.5; since a code value is 0.002 D, one point is 0.025/0.002 = 12.5 code values, and multiplying by both factors counts the 0.025 twice, giving 0.3125 code values per point. Read as written, the arithmetic is 40 times too small.

**Try it.** Open [grey balance](#bench-03-inversion). It prints a grey scale and a coloured patch shot under a cast, with each layer of film and paper reduced to its own characteristic curve. Correct the cast with `mode` set to `printer lights`, then to `print density`, and compare the highlights: with the density shift the white step stays tinted. Then raise `cast` and watch the toe of the printer-light scale drift too.

## 3.7 Calibration

Everything so far assumed the scanner's channels were known. Calibration measures them, and the order matters: first the photometric part (black level, flare, nonlinearity), which affects every colour alike, then the spectral part.

A **neutral wedge**, a strip of steps whose spectral density is flat, separates the two. A flat density dd transmits 10−d10^{-d} at every wavelength, so with ∑λPk=1\\sum\_\\lambda P_k = 1

Dk=−log⁡10∑λPk(λ) 10−d=d D_k = -\\log\_{10}\\sum\_\\lambda P_k(\\lambda)\\,10^{-d} = d

in every channel of every scanner, whatever its responsivities: a flat step of 1.234 D reads 1.234000 through all three channels of all four families in this chapter (`m11_wedge.js`). Any departure is photometric. Rozzi uses exactly this to fit the tone curves before the filters (US 6,633,408, col. 9), and the wedge measures flare: with f=0.5 %f = 0.5\\,\\% the steps 0, 0.5, …, 3 D read 0, 0.495, 0.981, 1.438, 1.826, 2.090 and 2.224, and a least-squares fit of D′=−log⁡10((10−d+f)/(1+f))D' = -\\log\_{10}\\bigl((10^{-d} + f)/(1 + f)\\bigr) to those readings with 0.005 D of noise recovers f=0.00503f = 0.00503.

The spectral part is harder because the unknowns are curves. Jiang and colleagues measured 28 cameras and found their sensitivities nearly two-dimensional: per channel, the first principal component explains over 95 % of the variance and the first two over 97 % (WACV 2013, Sec. 3.4). Chromogen ships those measurements (`data/cameras/measured.json`, with four more cameras from G. Butcher), and recomputing on the 28 at their 33 bands gives 93.4, 98.1 and 97.5 % for one component in red, green and blue and 97.0, 99.0 and 98.5 % for two (`m10_pca.py`): close to the paper, except that red's first component falls short of 95 %. Those percentages are of the curves' total energy, most of which is the shape all cameras share. Measured around the mean, the variation between cameras is less tidy: two components explain 71, 81 and 69 % of it, and the mean plus two components reconstructs a camera's curve to a median RMS error of 0.03 of its peak, 0.11 at worst. Two numbers per channel are a good prior for fitting a camera to a chart, not a substitute for measuring one. The Studio's X-T5 profile is such a fit, made in the long book's Appendix E: LED peaks of 678, 532 and 472 nm found from how each LED leaks into the camera's other channels.

spektrafilm's `utils/measure.py` checks the stock side. `measure_gamma` returns the slope between the densities 0.25 and 1.0, `measure_slopes_at_exposure` the slope over one stop either side of a log exposure, and `measure_density_min` fits an error-function toe to the lowest tenth of each curve and returns its floor. None is called anywhere in spektrafilm, and on the profiles' own curves `measure_gamma` fails: it inverts each curve with a cubic `interp1d` on density, and the flat toe and shoulder repeat densities (10, 9 and 4 values for Portra 400), so scipy raises "Expect x to not have duplicates". Made strictly increasing, as Chromogen's `Curve` does, Portra 400's gammas are 0.536, 0.499 and 0.577 (`m15_measure.py`). `utils/calibration_targets.py` renders strips of a test image under a ramp of one parameter (exposure, print exposure, grain, couplers, glare). It has two bugs that a port shows (`calib_copy_check.py`): each step is a `copy.copy` of the base parameters, which shares the nested camera and enlarger objects, so every step of a ramp is simulated with the ramp's last value (\[2, 2, 2\] for a ramp of −2, 0, 2 EV, though the labels read −2, 0, 2); and the constructor's `steps` argument is overwritten by `clean_params`'s default of 7. `copy.deepcopy` fixes the first.

Chromogen's evaluation tools make such choices comparable. `data.js` builds datasets: synthetic frames for every combination of factors, each carrying its truth (exposures, dye amounts, the true print), measured cameras and registered scans, with splits that hash a group so that adding rows never moves an old one. `evaluate.js` runs pipeline variants over a dataset, one row per variant, frame, patch and metric, with exactly mergeable summaries and a paired bootstrap that resamples whole clusters. On six synthetic running frames (three exposures, two scanners), the analytical 3×3 prints with a median CIEDE2000 error of 1.50 through the narrowband LEDs and 23.8 through the white-LED camera when printed with the true lights, which isolates the solve from the balance; the spectral solve's error is below 0.0001 (`m12_eval.js`). The comparison reports only two roll clusters and says its interval is unreliable, rightly. One bug surfaced on the way: `Results.where` passes `rows: undefined` to the constructor, which assigns it after the filtered rows, so every method of a filtered result fails.

## 3.8 Prior art and what three channels cannot recover

Chromogen's default solve follows the architecture of Rozzi's patent closely (US 6,633,408, cols. 4–8): unknowns in the film's colorant space rather than its spectrum, a Beer–Bouguer film model whose base is unexposed film, a forward model of the scanner, a bounded search for the amounts whose predicted reading matches the measured one, and a cheap first guess. The patent gives two reasons for searching three amounts instead of a 16- to 36-band spectrum that this chapter's numbers bear out: it is faster, and it excludes metameric spectra the film cannot produce (cols. 5–6). Its dyes come from factor analysis of measured spectra and may have small negative lobes (cols. 6–7), as spektrafilm's do. What Chromogen adds is mostly measurement: channels built from measured or specified spectra instead of fitted Gaussians, a residual vector and its closed-form Jacobian instead of a scalar distance, densities relative to the rebate so that the base cancels, noise-aware classes that turn the residual into a diagnosis, a flat field in sensor coordinates, and a solve tabulated on the GPU ([Chapter 4](#ch-4)). DeCaro and Shafer take the hardware route, mixing LEDs until a scanner's channels match the paper's printing-density sensitivity (US 5,982,957, col. 5).

Three channels leave three things undetermined, and each is a limit no solver can remove.

- **The scene's spectrum.** The solve recovers dye amounts and, through the inverse curves, the film's three layer exposures. Different scene spectra that give the same three exposures are indistinguishable from the negative ([Chapter 1](#ch-1)).
- **Interimage effects from a single frame.** With couplers, each layer's dye depends on all three exposures ([Chapter 2](#ch-2)). One frame gives three numbers per pixel; a coupling matrix composed with suitably adjusted curves reproduces the same dye amounts, so the coupling cannot be read from the frame itself. It needs a calibration exposure, such as a step tablet in one colour with a uniform flash in the other two (US 6,985,253, col. 5, after James p. 534), and Chromogen's `uncouple` slot defaults to none.
- **The stock's identity.** Solving the running frame, shot on Portra 400, with the dyes of Portra 160, Portra 800, Gold 200, Ektar 100 or Fujifilm C200 leaves a residual below 10−610^{-6} D on every patch for both scanners (`m14_stall_stock.js`): three equations in three unknowns have an exact solution for any reasonable dye set. The amounts differ, by up to 0.06 through the narrowband LEDs and 0.14 through the white-LED camera at the grey card, and so does the print. The scan cannot name its stock; the rebate's colour, the edge print or the user must.

## 3.9 Toward a reusable API

The chapter's mathematics reduces to a small vocabulary.

```text
Channels      { P: [3 × n] }            responsivities, each summing to 1; read(D(λ)) → 3 scanner densities
Forward       (c) → { D, J }            densities and closed-form Jacobian of a stock seen through Channels
solve(d, { lo, hi, activeSet, gtol, tolerance, maxIterations, stall })
              → { c, residual, iterations, stop }      bounded LM from clip(K⁻¹(d − D_base))
flatGrid(flat, transfer, cells) → Grid   illumination in sensor coordinates; divide before orienting
sigmaD(T, Treb) → σ[3]                  robust noise of density above the rebate at this resolution
classify(T, Treb, σ, residual, Z = 3) → 'below' | 'blank' | 'gamut' | 'ok'
latd(Ds) → [3]                          large-area transmission density in the paper's bands
integrate(alpha) : frame → Lights       printer lights: log-exposure offsets, never densities
```

Four laws make good unit tests. Round trip: for any c\\mathbf c inside the box, `solve(Forward(c).D).c` returns c\\mathbf c to within the tolerance, and the residual is below 10−610^{-6} D. Flat wedge: a spectrally flat density dd reads dd in every channel of every `Channels`. Active set: with `activeSet` on, the residual is never higher than without it by more than the tolerance (it fails at one node of 143,748 in Section 3.4 by 5×10−65 \\times 10^{-6} D, which is what such a test is for). Flat field: dividing a frame by a flat of its own illumination returns its densities to within the flat's noise (0.0006 D in Section 3.1).

## Code in this chapter

| module | what it computes | section |
| --- | --- | --- |
| `chromogen/src/solve.js` | forward model, closed-form Jacobian, analytical start, bounded LM with optional active set, stall and gtol stops | 3.2–3.4 |
| `chromogen/src/program.js` | `invert` programs: rebate check, solve per patch, σ warning, integrate-to-grey with `alpha`, other balances | 3.1, 3.2, 3.6 |
| `chromogen/src/evaluate.js` | metrics, runs, mergeable summaries, paired cluster bootstrap; the `Results.where` bug | 3.7 |
| `chromogen/src/data.js` | synthetic datasets with truth, measured cameras, scans, group-hashed splits | 3.7 |
| `studio-app/src/source.js` | sample decoding, flat-field grid and division, noise σ, rebate, `classify` and `Z_NOISE` | 3.1, 3.5 |
| `studio-app/src/decode.js` | TIFF and 16-bit PNG decoding as stored; the sRGB decode | 3.1 |
| `spektrafilm/utils/measure.py` | gamma, slope at an exposure, toe floor of a curve | 3.7 |
| `spektrafilm/utils/calibration_targets.py` | parameter ramps rendered as test strips; the shallow-copy bug | 3.7 |
| `corpus_txt/kodak_us6633408.txt` | Rozzi: colorant-space search, gain–offset–gamma scanner model, wedge and target fits | 3.1, 3.3, 3.7, 3.8 |
| `corpus_txt/kodak_us5982957.txt` | DeCaro and Shafer: scanner sensitivity as light × sensor, LEDs matched to printing density | 3.1, 3.8 |
| `corpus_txt/kodak_us6985253.txt` | Figueroa et al.: printer points, the interimage test | 3.6, 3.8 |

## Exercises

**Exercise.** With the white-LED KK of Section 3.2 and the grey card's densities above the rebate (0.556, 0.679, 0.884), compute the analytical start by hand and compare it with the first row of the trace in Section 3.3. (Five minutes.)

**Exercise.** Show that in the active-set step a held dye does not move, by writing out the 3 × 3 system with its row and column replaced by the identity and its gradient set to zero. Then show that if every dye is free the step is the ordinary LM step.

**Exercise.** In [the LM path](#bench-03-inversion), find the smallest red density for which the answer leaves the bound. Compare it with where the unconstrained minimum crosses zero cyan, and explain the difference from the gradient test.

**Exercise.** A pixel at base has Dk∼N(0,σ)D_k \\sim N(0, \\sigma) in each channel. For the narrowband scanner (take J(0)J(\\mathbf 0) as diagonal), derive the probability that its residual exceeds 0.01 D as a function of σ\\sigma, and check it against the 37.7 % and 6.2 % of Section 3.5.

**Exercise.** Project: capture a flat field and a neutral wedge with your own scanner, fit the flare ff from the wedge, and measure how the Gold-200-style shadow floor of Figure 3.4 changes on one of your frames after dividing by the flat.

## Sketches in this chapter

4 sketches; choose one from the menu. Drag the parameters, or open the source and edit it: edits stay in this browser.

## Key points

- A scanner channel is light × filter × sensor, and Chromogen normalises it so that scanner density is relative to clear light; the rebate then fixes the zero and the stock's base reading restores the absolute scale.
- The dye solve minimises the squared residual over a box, so it returns an answer for every pixel and a residual that says how far the pixel is from anything the film can make.
- The Jacobian entry JkjJ\_{kj} is dye jj's density averaged under the light reaching channel kk, constant for narrow channels and falling with density for broad ones; its smallest singular value sets the noise gain, 0.89 for narrowband LEDs and up to 29 for a white-LED camera.
- `solve.js` is Levenberg–Marquardt with combined Levenberg and Marquardt damping and an accept-or-reject update instead of a gain ratio; from the analytical start it needs two or three iterations on reachable pixels through narrowband channels and a median of four through the white-LED camera.
- Clipping a full step to the box makes LM creep along a bound; holding the dyes a bound is holding (the active set) reaches the constrained minimum in a few iterations and made the Studio's table 5.4 to 6.8 times faster, never worse beyond the tolerance but at one node.
- Unreachable pixels on a real scan are classified by zk=Dk/σkz_k = D_k/\\sigma_k with Z=3Z = 3 into blank film, below base and out of gamut; on the Gold 200 frame almost all are blank or below base, the percentages depend on resolution and on whether the residual is tabulated, and the shadow floor shows light 0.03 to 0.04 D stronger in the middle of the frame.
- Balance is a shift of the paper's log exposure (printer lights): on a 3,800 K cast it leaves at most 2.4 ΔE00, while the same correction as a print density leaves 14.6 and tints the paper white.
- Three channels cannot recover the scene's spectrum, interimage coupling from one frame, or the stock's identity: every stock's dyes fit the running frame exactly.

## Further reading

- Hunt, *The Reproduction of Colour*, 6th ed., 14.17 (pp. 231–233): why a correction along the density axis cannot replace one along the log-exposure axis; 16.7 (pp. 265–266): integrating to grey and colour failure; 16.13 (pp. 270–274): slope control.
- Giorgianni and Madden, *Digital Color Management*, 2nd ed., App. B, pp. 334–336: effective responsivities, scanner density and printing density (Eqs. B.4–B.7).
- Rozzi, US 6,633,408 (2003), cols. 4–12: the colorant-space search, the Beer–Bouguer film model, the gain–offset–gamma scanner model and its wedge and target calibration.
- DeCaro and Shafer, US 5,982,957 (1999), cols. 3–6: scanner sensitivity as illumination × sensor, and LEDs mixed to match printing density.
- Figueroa, Maier and Brewer, US 6,985,253 (2006), cols. 3–5: printer points, scanner-to-printing-density matrices, the interimage test.
- Jiang, Liu, Gu and Süsstrunk, "What is the space of spectral sensitivity functions for digital color cameras?", WACV 2013, Sec. 3: 28 measured cameras and their principal components.
- Nocedal and Wright, *Numerical Optimization* (classic): Levenberg–Marquardt as a trust-region method, and bound-constrained optimisation.
- Bertsekas, "Projected Newton methods for optimization problems with simple constraints", SIAM J. Control Optim. 20 (1982) (classic): the step behind `activeSet`.
- *Chromogen Studio*, chapters 10 and 11 (`studio-app/content/book/`): the base map and the speed work, rechecked here.

4

### Making it fast: from equations to real time

General techniques first, then how Chromogen Studio uses them, with measurements.

Chapters 1 to 3 give the colour negative as equations, and done literally for every pixel they are slow. One pixel of the Gold 200 frame needs a dye solve of about six passes over an 81-sample spectrum, then two more spectral integrals for the paper and the print: several hundred exponentials. Chromogen Studio's working image of that frame has 1090 × 754 = 821,860 pixels, and solving each of them in JavaScript would take about 5 s per redraw on one core (6.1 µs per solve, measured in node). The Studio instead redraws the frame with one texture fetch per table per pixel, which even a software renderer does in 0.65 s, and its slowest step, rebuilding the tables after a change of film, takes 0.15 s on two workers. **Staging** moves work to where it is done least often, **tabulation** replaces a function of three numbers with a 33³ table, the GPU evaluates the per-pixel remainder, workers and compute shaders build the tables, and a benchmark checks every fast path against the slow one. Each technique is shown in general, then in the Studio's code and spektrafilm's. Afterwards you should be able to look at an image algorithm, find what its result depends on and how often that changes, choose a table, a kernel or a parallel scheme for it, and prove the faster version correct.

Unless labelled otherwise, every number was measured for this chapter by a script in `work/04-making-it-fast/`: CPU times in node 22 on two cores, browser times in headless Chromium 153 with WebGL2 and WebGPU on SwiftShader, a software renderer whose times rank passes but do not say how fast a GPU is. Numbers labelled *measured earlier* come from the Studio's own write-up of this work, `studio-app/content/book/11-speed.md`.

## 4.1 Binding time: compute once what changes rarely

Every quantity in a program has a **binding time**: the moment its value becomes known. In the Studio the film's dye spectra are bound when the film is chosen, the rebate's transmittance when the scan is opened, a printer light when a slider moves, and a pixel's transmittance when that pixel is processed. A computation need run no more often than its inputs change. **Staging** places each computation at the latest binding time of its inputs, so that work which depends only on the film is done once per film, not once per pixel per redraw.

The dye solve shows what staging buys. Its inputs are the scanner's channel responsivities Pk(λ)P_k(\\lambda), the film's unit dye spectra εj(λ)\\varepsilon_j(\\lambda) and base b(λ)b(\\lambda), and one pixel's scanner density D\\mathbf D. The first three are bound per scanner and film, the last per pixel. Fix the first three and the solve becomes a function of three numbers, c=s(D)\\mathbf c = s(\\mathbf D). **Partial evaluation** runs a program on the inputs already bound and leaves a smaller program in the rest; for a function of three numbers that program can be a table, evaluated on a grid once and interpolated at run time. The Studio's grid has 333=35,93733^3 = 35{,}937 nodes, 23 times fewer than the working image's pixels, and it is built once per scanner and film instead of once per redraw.

| Quantity | Depends on | Bound | Where in the code |
| --- | --- | --- | --- |
| scanner channels PkP_k | scanner, LED peaks | per scanner | `model.js` `makeScanner`, cache key `sc:` |
| dye-solve table c(a)\\mathbf c(\\mathbf a), 33³ | scanner, film | per scanner × film | `solveTable`, key `solve:` |
| printing-density table PD(c)PD(\\mathbf c), 33³ | film, paper (lamp fixed at 3200 K) | per film × paper | `pdTable`, key `pd:` |
| print table XYZ$(\\mathbf c_p)$, 33³ | paper, Fade (viewing light fixed at 5000 K) | per paper × fade | `printTable`, key `pr:` |
| film and paper curves, 512 entries | stock | per stock | `filmForward`, `filmInverse`, `paperCurves` |
| working image, noise σ | scan, crop, rebate, flat field | per scan × geometry | `source.js` `Source.working` |
| edge-aware bases, halation, bloom, statistics | negative-side settings | per change, at 640 px | `render.js` `global` |
| per-pixel chain | everything, sliders included | every redraw | `render.js` `frame` |

A printer-light slider changes only a uniform of the per-pixel pass; another paper rebuilds two tables but not the solve.

**Content-addressed caching.** Staging needs to know when a stage's inputs have changed. The Studio keeps every table in a map keyed by a string built from its inputs (`memoAsync('solve:' + scanner.id + ':' + peaks + ':' + film, …)` in `buildModel`), and the renderer uploads a texture only when its key changes (`Renderer.setModel`). Such a cache is correct only if **the key includes everything that changes the output**. The Studio broke that rule once: the working image was keyed on the scan's geometry and encoding, so two scans opened with identical settings shared a key, and switching between them could show the first image. The fix added a per-scan counter, `Source.uid`, to the key (`source.js`, `working`).

spektrafilm's spectral LUT service (`runtime/services/spectral_lut_compute.py`) validates its cache differently: it evaluates the spectral function at four probe dye triples (`_cmy_test_values`) and reuses the cached table if the results are bitwise equal to the stored ones. The probe catches any change to the function itself (film, paper, lamp, filters) but not to the table's *domain*. `printing.py` builds the enlarger table over \[−dmin,Dmax\]\[-d\_\\text{min}, D\_\\text{max}\], where dmind\_\\text{min} is the user's `grain.density_min`, and `compute_with_lut` normalises the data by the domain of the current call. I ran the service's own code (through a numba shim, §4.2) with a stand-in spectral function: after `density_min` moved from 0.03 to 0.10 the old 17³ table was reused and the result was off by up to 0.063 in log exposure (mean 0.028), against 3×10−53\\times10^{-5} for a fresh table. Adding `data_min`, `data_max` and the resolution to the comparison closes the hole.

Staging is not only for tables of physics:

- `export.js` writes 16-bit PNG (through the browser's native deflate), TIFF and zip files, whose CRC-32 checksums come from a 256-entry table built once: one lookup per byte instead of eight shift-and-xor steps, 15 ms for 6.6 MB against 248 ms bit by bit.
- spektrafilm's `boost_highlights` computes its constants a=281−ra = 28^{1-r}, x0x_0 and k=(2M−1)/(ea(1−x0)−a(1−x0)−1)k = (2^{M}-1)/(e^{a(1-x_0)} - a(1-x_0) - 1) once per call, and the pixel kernel evaluates only y=x+k xmax⁡(eaΔx−aΔx−1)y = x + k\\,x\_{\\max}(e^{a\\Delta x} - a\\Delta x - 1) above x0x_0. Numerically the maximum maps to xmax⁡2Mx\_{\\max}2^{M} (4 → 16 at M=2M = 2), values below x0x_0 are unchanged, and the slope just above x0x_0 is 1.002.
- `numba_warmup.py` calls every numba kernel once on a tiny array at start-up, so that just-in-time compilation, bound at the first call with given argument types, happens before the user's first image; `cache=True` keeps the compiled code on disk. numba is not installed here, so I could not time it.

## 4.2 Tables over density space

A **lookup table** stores a function's values at the nodes of a grid and answers a query by interpolating between the nodes that surround it. The Studio has three 3-D tables of N=33N = 33 nodes per axis (`model.js`, `N3`):

| Table | Key | Domain per axis | Stored per node |
| --- | --- | --- | --- |
| dye solve | analytical estimate a=K−1D\\mathbf a = K^{-1}\\mathbf D | `A_RANGE` = \[−0.25, 2.55\] | c1,c2,c3c_1, c_2, c_3, residual |
| printing density | negative dye amounts c\\mathbf c | `C_RANGE` = \[0, 2.6\] | three printing densities, 1 |
| print | paper dye amounts cp\\mathbf c_p | `CP_RANGE` = \[0, 2.7\] | X, Y, Z adapted to D65, 1 |

Here D\\mathbf D is scanner density above the rebate and KK the matrix of the analytical solve ([Chapter 3](#ch-3)), so the key is the solve's starting point. Node qq sits at indices i=q mod Ni = q \\bmod N, j=⌊q/N⌋ mod Nj = \\lfloor q/N\\rfloor \\bmod N, k=⌊q/N2⌋k = \\lfloor q/N^2\\rfloor (`nodeAt`), x fastest, the order a 3-D texture expects. Four 32-bit floats per node make each table 575 KB; the solve table's fourth channel carries the residual, so the shader reads with the dyes whether the pixel was reachable.

**Reading a table on the GPU.** A 3-D texture with linear filtering returns the trilinear blend of the eight texels around a coordinate in one fetch. Texel ii of an NN-texel texture covers \[i/N,(i+1)/N)\[i/N, (i+1)/N) and its value sits at the centre, (i+12)/N(i + \\tfrac12)/N. To read a table spanning \[ℓ,h\]\[\\ell, h\] at value vv, the normalised position u=(v−ℓ)/(h−ℓ)u = (v-\\ell)/(h-\\ell) must therefore be mapped to

u′=u (N−1)+12N, u' = \\frac{u\\,(N-1) + \\tfrac12}{N},

which `lut3` in `shaders.js` writes as `(u * 32.0 + 0.5) / 33.0`. Without the half-texel terms the table would be stretched by N/(N−1)N/(N-1). `look3` in `model.js` is the same lookup in JavaScript.

### How the error falls with the grid

Linear interpolation between x0x_0 and x0+hx_0 + h at fraction tt has error

L(t)−f(x0+th)=h22 t(1−t) f′′(ξ) L(t) - f(x_0 + th) = \\frac{h^2}{2}\\,t(1-t)\\,f''(\\xi)

for some ξ\\xi in the interval (expand ff to second order: the chord differs from the curve by the parabola t(1−t)t(1-t) scaled by the curvature). The largest value of t(1−t)t(1-t) is 14\\tfrac14, so the error is at most h28max⁡∣f′′∣\\tfrac{h^2}{8}\\max\\lvert f''\\rvert: linear interpolation is **second order**, O(h2)O(h^2), with the second derivative as the constant. Trilinear interpolation is linear interpolation along each axis in turn. It reproduces every function of the form α+∑iβiai+∑i\<jγijaiaj+δa1a2a3\\alpha + \\sum_i \\beta_i a_i + \\sum\_{i\<j}\\gamma\_{ij}a_ia_j + \\delta a_1a_2a_3 exactly, so the mixed second derivatives drop out and the leading error is

e(a)≈h22∑i=13ti(1−ti) ∂2c∂ai2,∣e∣≤h28∑i=13∣∂2c∂ai2∣. e(\\mathbf a) \\approx \\frac{h^2}{2}\\sum\_{i=1}^{3} t_i(1-t_i)\\,\\frac{\\partial^2 c}{\\partial a_i^2}, \\qquad \\lvert e\\rvert \\le \\frac{h^2}{8}\\sum\_{i=1}^{3}\\left\\lvert\\frac{\\partial^2 c}{\\partial a_i^2}\\right\\rvert .

I checked the formula on the solve table for the Gold 200 frame's set-up (the fitted X-T5 and LED scanner, Kodak Gold 200): at 2,001 (point, dye) pairs inside the reachable set, with second derivatives from central differences of exact solves, predicted and measured errors at N=33N = 33 agree to 1.5×10−61.5\\times10^{-6} and none exceeds the bound (`lutpredict.cjs`). The median of the largest ∣∂2c/∂ai2∣\\lvert\\partial^2 c/\\partial a_i^2\\rvert is 0.012 and the maximum 0.21, so at h=2.8/32=0.0875h = 2.8/32 = 0.0875 the bound is about 10−410^{-4} for typical points.

Figure 4.1 shows the error against hh for tables of 5 to 65 nodes per axis, at 20,000 random keys solved exactly. The points fall into two classes. In cells whose eight corners all lie inside the reachable set with no dye at a bound, the error falls as h2h^2: the trilinear rms error is 9.3×10−59.3\\times10^{-5} at N=33N = 33 and 2.3×10−52.3\\times10^{-5} at N=65N = 65, and each halving of hh divides it by 3.8 to 4.0. In cells that straddle the edge of the reachable set the error falls only as hh: the largest is 0.017 at N=33N = 33 and still 0.010 at N=65N = 65. The reason is the bound on dye amounts. Where one dye of the best fit reaches zero, the solve switches from the unconstrained answer to the constrained one ([Chapter 3](#ch-3)); c(a)\\mathbf c(\\mathbf a) stays continuous but its derivative jumps, and a linear interpolant across a **kink** errs in proportion to the cell size times the jump in slope. At N=33N = 33, 74 % of random keys fall in smooth cells.

**Figure 4.1.** Error of the dye-solve table against node spacing, for tables of NN = 5 to 65 nodes per axis over `A_RANGE`, at 20,000 random keys compared with exact solves (`lutstudy.cjs`; scanner xt5-fitted, Kodak Gold 200). Black: points whose cell lies inside the reachable set with no dye at a bound, as rms over the three dyes (solid, trilinear; dashed, tetrahedral) and largest (dotted, trilinear). Red: largest error in cells that straddle the edge of the reachable set. Grey lines of slope 2 and 1 are for reference; the dashed red line marks the Studio's table (film data: spektrafilm, CC BY-SA 4.0).

**Trilinear or tetrahedral.** Tetrahedral interpolation (Kasson, Nin, Plouffe and Hafner, *J. Electronic Imaging* 4(3), 1995) cuts each cube cell into six tetrahedra that share the main diagonal, picks the one containing the point by sorting the three fractions, and blends its four corners: if t1≥t2≥t3t_1 \\ge t_2 \\ge t_3, the value is (1−t1)v000+(t1−t2)v100+(t2−t3)v110+t3v111(1-t_1)v\_{000} + (t_1-t_2)v\_{100} + (t_2-t_3)v\_{110} + t_3v\_{111}. It reads four nodes instead of eight, is also second order, and on the solve table its rms error is 1.9 times lower at every NN (Figure 4.1). The Studio uses trilinear all the same, because a texture unit does trilinear interpolation in one fetch, while tetrahedral would need four unfiltered fetches and the comparisons; on a CPU the choice would go the other way.

**Where to spend nodes.** Doubling NN multiplies memory and build time by eight (2.1 s for 65³ against 0.27 s for 33³ in node) and divides the smooth error by four. Two levers are cheaper. One is the key: since the constant is the second derivative, choose coordinates in which the function is nearly linear. Keying on a\\mathbf a instead of D\\mathbf D lowers the error by a factor of 1.24 for the X-T5 scanner, whose KK is nearly diagonal, and 1.45 for the Studio's white-LED scanner (`keying.cjs`); the long book found a factor of three for its own white-light scanner over a different domain. The other is a **non-uniform grid**, denser where ∣f′′∣\\lvert f''\\rvert is large or along the kinks, at the price of a search per axis instead of one multiply; a GPU texture can only be made non-uniform by warping the key through a 1-D table first. spektrafilm's `fast_interp.py` is the CPU version in 1-D: a sorted, possibly uneven axis, the reciprocal of every interval precomputed so no sample divides, a binary search (`np.searchsorted`) per sample, end values held outside, pixels in parallel with numba's `prange`; it matched `np.interp` to 4×10−164\\times10^{-16}.

**Where the domain must stop.** `lut3` clamps uu to \[0,1\]\[0, 1\], so a key outside the domain reads a boundary node: bounded but wrong. The domain must cover every key the data produce, including noise below the base (slightly negative keys), and no more, since hh grows with the span. On the Gold 200 frame no pixel's key falls outside `A_RANGE` (`gold.cjs`). Nodes outside the reachable set store a clamped solve with a residual above 0.01, and that channel is interpolated too: at N=33N = 33, 186 of the 20,000 random keys (0.9 %) land on the other side of 0.01 from their exact residual, all along the edge of the reachable set.

**Storage precision.** Tables are 32-bit float textures when the browser can filter them (`OES_texture_float_linear`), otherwise 16-bit floats converted by `toHalf` in `render.js`. A 16-bit float has an 11-bit significand, so near 2.0 its values are 2−9≈0.0022^{-9} \\approx 0.002 apart: dye amounts to about ±0.001\\pm0.001, ten times below the 0.01 D residual flag. Storing the 64-bit solve as 32-bit floats changes it by at most 1.2×10−71.2\\times10^{-7}; the interpolation weights can be the larger limit.

**Careful.** GPU texture units compute filtering weights in fixed point; NVIDIA documents 8 fractional bits (CUDA C Programming Guide, appendix on texture fetching). Rounding the fractions to 8 bits in `look3` (a model, not a GPU measurement) raises the solve table's rms error at N=33N = 33 from 9.2×10−59.2\\times10^{-5} to 1.6×10−41.6\\times10^{-4}; more precision needs interpolation in the shader from unfiltered fetches.

**One-dimensional functions in one-dimensional tables.** The characteristic curves act on each layer separately, so they are 512-entry 1-D tables over \[−2.5,2.5\]\[-2.5, 2.5\] log H, rows of one 2-D texture (`curveTable`, `lut1`). Giorgianni and Madden give the same advice: channel-independent operations belong in 1-D tables, and a 3-D table asked to reshape greyscale tends to shift the hue of neutrals (Giorgianni & Madden, App. I).

**spektrafilm's tables.** `utils/lut.py` evaluates any image function on a `steps`³ grid over \[xmin⁡,xmax⁡\]\[x\_{\\min}, x\_{\\max}\], reshaped into a `steps`² × `steps` "image" so the spectral code runs on it unchanged; `compute_with_lut` normalises the data to \[0,1\]\[0, 1\] and calls `apply_lut_3d`. The runtime uses 17 nodes per axis, and tables are off by default (`use_enlarger_lut = use_scanner_lut = False`). `fast_interp_lut.py` interpolates cubically, by one of two methods:

- `'pchip'`, the default, uses cubic Hermite segments along each axis with slopes from a monotonicity-preserving limiter (zero at an extremum, else the harmonic mean of neighbouring differences), blends cross-axis slopes linearly, and clamps to the range of the cell's corners, so it never overshoots. `apply_lut_pchip_3d` calls `prepare_lut_pchip_3d` on every application, although its docstring says it is meant to run once per table; the Python-level monotonicity check alone took 13.5 ms per call at 17³ and 48 ms at 33³.
- `'mitchell'` uses the Mitchell–Netravali filter with B=C=13B = C = \\tfrac13 over a 4 × 4 × 4 neighbourhood (64 nodes per lookup instead of 8). That filter approximates rather than interpolates: at a node its weights are 118,1618,118\\tfrac1{18}, \\tfrac{16}{18}, \\tfrac1{18}, so it returns f+h2f′′/9f + h^2 f''/9 instead of ff. On a table of x2x^2 with h=1/16h = 1/16 it returned the node value plus 4.34×10−44.34\\times10^{-4}, exactly h2/9h^2/9.

numba is not installed here, so I ran these modules through a shim (`py/spk_shim.py`) that makes `@njit` the identity and `prange` a `range`: the same code, unjitted.

**Try it.** Open [the table-error sketch](#bench-04-making-it-fast), which slices the solve table along the yellow key. Set N to 9, then 17, then 33: the scallops between nodes shrink by about four per step (the readout gives 4.6×10−34.6\\times10^{-3}, 9.6×10−49.6\\times10^{-4}, 2.9×10−42.9\\times10^{-4}), while next to the gamut edge (the red wash) the error stays ten to a hundred times larger. Switch the mode to tetrahedral and compare the two curves.

**Exercise.** At N=17N = 17, what bound does the formula give for a point at mid-cell along one axis where ∂2c/∂a2=0.158\\partial^2 c/\\partial a^2 = 0.158 (the 99th percentile) and the other two axes sit on nodes? Compare with the trilinear maximum at N=17N = 17 in Figure 4.1 and say which class of cell sets that maximum.

## 4.3 The cost of a neighbourhood

A **convolution** replaces each pixel by a weighted sum of its neighbours, g(x,y)=∑i,jwij f(x−i,y−j)g(x,y) = \\sum\_{i,j} w\_{ij}\\,f(x-i, y-j), so it costs pixels × taps. A blur of standard deviation σ\\sigma needs a radius R≈3σR \\approx 3\\sigma, and a direct 2-D kernel has (2R+1)2(2R+1)^2 taps: 2,809 for the R=26R = 26 box of the Studio's contrast mask at 640 px. The Studio runs eight blur passes per frame, so the radius decides whether a frame is cheap.

**Separable kernels.** A kernel is **separable** if it is a product wij=uivjw\_{ij} = u_i v_j. Then the 2-D sum factors into a sum along rows followed by a sum along columns, 2(2R+1)2(2R+1) taps instead of (2R+1)2(2R+1)^2: 106 instead of 2,809 at R=26R = 26. The Gaussian is separable, since e−(x2+y2)/2σ2=e−x2/2σ2e−y2/2σ2e^{-(x^2+y^2)/2\\sigma^2} = e^{-x^2/2\\sigma^2}e^{-y^2/2\\sigma^2}, and so is the box. Every Studio blur is two passes of one shader, `FS_BLUR`, along `dir` = (1/w, 0) and (0, 1/h).

**Truncating the radius.** `blurKernel` in `render.js` stops a Gaussian at R=⌈3σ⌉R = \\lceil 3\\sigma\\rceil (at most 96) and divides the weights by their sum, so a flat field stays flat. The tails beyond 3σ3\\sigma hold 0.27 % of each 1-D kernel's weight; renormalising makes the kernel slightly narrower, not the image darker.

**Weights on the CPU, loops to the radius.** The Studio's first blur looped over a fixed range −96≤i≤96-96 \\le i \\le 96, skipped taps outside the kernel with `continue` (a habit from GLSL ES 1.00, which demanded constant loop bounds) and computed an `exp` per tap per pixel; with every operator on, the blurs took 83 % of a frame (measured earlier). `FS_BLUR` takes its weights from a uniform array `kw[97]` that `blurKernel` fills once per pass, loops to the kernel's own radius, and fetches the taps at +i+i and −i-i together:

```glsl
uniform sampler2D t; uniform vec2 dir; uniform int R; uniform vec2 kw[97];
void main() {
  vec4 acc = texture(t, uv) * kw[0].xxyy;
  for (int i = 1; i <= R; i++) {
    vec2 d = dir * float(i);
    acc += (texture(t, uv + d) + texture(t, uv - d)) * kw[i].xxyy;
  }
  o = acc;
}
```

The write-up measured the blurs 3.3 times faster and the frame 2.3 times faster, with no output pixel changed by more than one level (measured earlier). I rebuilt the first version from its outline (`studio-passes.cjs`): on SwiftShader with every operator on, the blur passes took 3,284 ms with it and 682 ms with `FS_BLUR`, and the outputs differed by at most one level; my reconstruction is slower than the original, so only the direction carries over. Each weight is a `vec2`, one kernel for the first two channels and another for the last two (`kw[i].xxyy`), so two box means or halation's two Gaussians cost one pass.

**Bilinear taps.** A texture fetch with linear filtering at position i+ti + t between texels ii and i+1i+1 returns (1−t)fi+tfi+1(1-t)f_i + t f\_{i+1}. Two adjacent taps with weights wiw_i and wi+1w\_{i+1} want wifi+wi+1fi+1w_if_i + w\_{i+1}f\_{i+1}, which is that blend scaled:

wifi+wi+1fi+1=(wi+wi+1)\[(1−t)fi+tfi+1\],t=wi+1wi+wi+1. w_if_i + w\_{i+1}f\_{i+1} = (w_i + w\_{i+1})\\big\[(1-t)f_i + t f\_{i+1}\\big\], \\qquad t = \\frac{w\_{i+1}}{w_i + w\_{i+1}} .

One fetch at offset i+ti + t, weighted wi+wi+1w_i + w\_{i+1}, replaces two: about R+1R + 1 fetches per pass instead of 2R+12R + 1. The Studio does not use the trick, because its two packed kernels would need different offsets for the same pair of texels.

**Lower resolution for wide kernels.** At half the resolution a kernel of the same physical width has a quarter of the pixels and half the taps, an eighth of the work. The Studio runs every wide kernel in the **global pass** at 640 px on the long side, with radii as fractions of the frame. Bloom, the widest (σ\\sigma = 3.5 % of the long side, 22 px at 640), is thresholded at 640 px and blurred at 320 px; a half-size texel's centre falls between four full-size ones, so filtered fetches do the downsampling. In my rerun the bloom blurs took 489 ms at 640 px (R=68R = 68) and 99 ms at 320 px (R=34R = 34), 4.9 times less (the write-up measured 550 and 62 ms). With bloom at 30 the print changed by 0.018 levels on average and at most 6 levels in 255.

**Summed-area tables.** Some kernels can be evaluated at a cost independent of their size. A **summed-area table** (Crow, *SIGGRAPH* 1984) stores at each position the sum of all values above and to the left of it,

S(x,y)=∑x′\<x ∑y′\<yf(x′,y′), S(x, y) = \\sum\_{x' \< x}\\ \\sum\_{y' \< y} f(x', y'),

built in one pass with S(x+1,y+1)=f(x,y)+S(x,y+1)+S(x+1,y)−S(x,y)S(x{+}1,y{+}1) = f(x,y) + S(x,y{+}1) + S(x{+}1,y) - S(x,y). Any box sum then costs four reads: ∑x0≤x′\<x1, y0≤y′\<y1f=S(x1,y1)−S(x0,y1)−S(x1,y0)+S(x0,y0)\\sum\_{x_0 \\le x' \< x_1,\\ y_0 \\le y' \< y_1} f = S(x_1,y_1) - S(x_0,y_1) - S(x_1,y_0) + S(x_0,y_0). The Studio's noise estimate uses this (`sigmaD` in `source.js`, [Chapter 3](#ch-3)): each density is compared with the mean of the other pixels in its 9 × 9 neighbourhood, μi=(box sum−Di)/(n−1)\\mu_i = (\\text{box sum} - D_i)/(n-1), and the noise is 1.4826×1.4826 \\times the median of ∣Di−μi∣\\lvert D_i - \\mu_i\\rvert; a second table counts the kept pixels. Both tables are `Float64Array`s, and that matters: entries grow to the sum of the whole image, and a box sum is a small difference of large entries. On a synthetic flat field of density 0.8 with noise σ=0.010\\sigma = 0.010 D, the estimate from 64-bit tables is 0.0100 to 0.0101 at every size. With 32-bit tables it is 0.0102 at 1090 × 754, 0.0147 at 2048 × 1365 and 0.056 at 4096 × 2731, where the largest sum is 9×1069\\times10^6 and adjacent 32-bit floats there are a whole unit apart (`sat32.cjs`).

A fragment shader cannot build the table in one pass: it is a **prefix sum**, each output depending on everything before it, and takes log⁡2\\log_2 of the width in passes on a GPU. So the Studio pays O(R)O(R) per box with `FS_BLUR` and keeps RR small at 640 px. On the CPU three box filters in succession approximate a Gaussian (each box of width ww adds variance (w2−1)/12(w^2-1)/12) at a cost independent of σ\\sigma.

**Recursive filters.** For σ≥3\\sigma \\ge 3 spektrafilm's `fast_gaussian_filter.py` uses a **recursive** (IIR) filter: each output comes from the input and the last three outputs, wn=Bxn+b1wn−1+b2wn−2+b3wn−3w_n = B x_n + b_1 w\_{n-1} + b_2 w\_{n-2} + b_3 w\_{n-3}, forwards then backwards along every row and column, about 28 multiply-adds per pixel whatever σ\\sigma is. The coefficients in `_yvv_coeffs` are Young and van Vliet's (*Signal Processing* 44, 1995; q=0.98711σ−0.96330q = 0.98711\\sigma - 0.96330, then b0…b3b_0 \\ldots b_3 as cubics in qq). The module's own code gives impulse responses with standard deviations 3.30, 5.56, 10.99, 21.7 and 42.7 pixels for requested 3, 5, 10, 20 and 40: the blur is 7 to 10 % wider than asked (`py/spk_experiments.py`; an independent port, `py/yvv_check.py`, agrees, and q=8.00q = 8.00 rather than the code's 8.91 would give σ=10\\sigma = 10 exactly). Below σ=3\\sigma = 3 the module uses a direct separable kernel, fused over strips of 16 rows so the intermediate stays in cache. Its docstring says `mode='reflect'`, but the recursive path repeats the edge sample.

**The Fourier transform.** By the convolution theorem a blur of any width costs two FFTs and a product, O(log⁡n)O(\\log n) per pixel. spektrafilm's `fft_gaussian_filter.py` multiplies by the Gaussian's analytic transform e−2π2σ2f2e^{-2\\pi^2\\sigma^2 f^2} on the DFT's frequency grid, so nothing is truncated; `truncate` only sets the padding, `int(truncate * sigma + 0.5)` pixels, that keeps one edge from wrapping into the other. Its docstring gives `truncate` a default of 4.0, the signature 7.0. The padding, `np.pad(mode='reflect')`, does not repeat the edge sample (SciPy's `'mirror'`), while the module's test compares with SciPy's `mode='reflect'`, which does: on a ramp the result matches `'mirror'` to 10−1210^{-12} and differs from `'reflect'` by up to 0.0024 near the edges. With numpy's FFT in place of pyFFTW on 1024 × 1024 it took 132 ms at σ=2\\sigma = 2 and 208 ms at σ=32\\sigma = 32, against 41 and 169 ms for SciPy's separable filter.

**Figure 4.2.** The cost of a Gaussian blur against σ\\sigma on a 640 × 443 single-channel image, the size of the Studio's global pass. Left: reads per output pixel by arithmetic for a direct 2-D kernel, (2R+1)2(2R+1)^2; a separable pair, 2(2R+1)2(2R+1); a separable pair with bilinear taps, 2(⌈R/2⌉+1)2(\\lceil R/2\\rceil+1); and three box filters from summed-area tables, 12 reads. Right: times measured in node in plain JavaScript (`blurcost.cjs`, best of five) for the direct kernel, the separable pair, the pair with its ±i taps summed before weighting (as `FS_BLUR` does), three box filters, a recursive filter and a radix-2 FFT; the red curve is the separable kernel the Studio's shader computes.

In Figure 4.2, in JavaScript, the direct kernel already takes 1.9 s at σ=8\\sigma = 8, the separable pair grows linearly to 533 ms at σ=64\\sigma = 64, the box filters and the recursive filter stay near 5 ms at every σ\\sigma, and the FFT overtakes the separable kernel only at σ=32\\sigma = 32. A fragment shader can only gather, so on a GPU the separable kernel at reduced resolution is what fits, and it is the Studio's choice.

**Try it.** Open [the blur-cost sketch](#bench-04-making-it-fast). At σ = 6 lower the truncation k from 3 to 1.5: the largest error against the exact blur rises from 0.7 to 20 levels in 255. Back at k = 3, switch half resolution on: the cost falls to 0.13 of the full-size blur and the largest error is 1.3 levels.

## 4.4 The GPU as a function evaluator

After staging, what remains per pixel is a short chain of lookups and arithmetic. A GPU runs it as a **fragment shader**: a function evaluated once for every pixel of a target, many at a time, each invocation knowing only its own coordinate. The Studio uses WebGL2, a drawing API, as a map over pixels. Each **pass** binds a program and a target, draws one triangle with corners (−1, −1), (3, −1) and (−1, 3), which covers the whole target (`render.js`, the vertex buffer in the constructor), and writes the result into a texture through a framebuffer (`target`). The next pass reads that texture. A fragment shader can read any texel of its inputs but writes only its own pixel: it **gathers**. Blurs, lookups and per-pixel arithmetic are gathers and map directly. Histograms and sums **scatter** (one input adds to an output chosen by its value) and do not; the Studio builds its print-window histogram on the CPU from a 640-px read-back.

One frame (`frame`, after `global`) is these passes:

- **global pass, 640 × 443:** the film's exposure without halation and its two blurs (halation), the dye amounts, the printing density, the guided filter's inputs, four box-blur passes and its coefficients (the edge-aware bases), the print, the bloom source and two blurs at 320 × 222;
- **working size, 1090 × 754:** dye amounts, printing density, print, output.

Passes are cut only where the next step reads neighbours (grain reduction, Texture, sharpening); everything between cuts runs in one shader, since each cut writes and rereads a 13 MB float target.

**Figure 4.3.** The passes of one Studio frame with every operator on (sharpness 60, grain reduction 40, mask 40, bloom 40, halation 60, grain 60, clarity 30, texture 30), in order, each timed with a one-texel read-back after it, in headless Chromium on SwiftShader (`studio-passes.cjs`, the second of three runs). Red bars are blur passes. Stalling after every pass makes the sum, 2,781 ms, larger than the 1,410 ms of the same frame timed once at its end; the proportions are what to read.

Figure 4.3 shows where a frame's time goes on SwiftShader. The eight blur passes take 51 % of the stalled total, the four passes at the working size 37 %, and the printing-density pass at the working size, which runs the 5 × 5 bilateral filter of grain reduction (25 taps, each with an `exp`), is the largest single per-pixel pass.

**Float textures.** Rendering into float targets needs `EXT_color_buffer_float`, which the Studio requires; the scan is uploaded once per source as 16-bit floats, halving the upload.

**Every sampler must be bound.** WebGL is a state machine: textures are bound to numbered units, and a sampler names a unit. A sampler that a pass does not set keeps its last unit and whatever texture is bound there. Two bugs came from that. The first made exports black: a new sampler in the output shader, unbound by the export's output pass, pointed at the unit where creating the export target had bound that target's own texture, so the shader read the texture it was drawing into, a **feedback loop**, which WebGL refuses. The fix gives every sampler of the program a binding on every draw: the textures the pass names, then a 1 × 1 placeholder for every other sampler. The second bug was in the fix: creating the placeholder texture bound it to whatever unit was active, which had just been given the film's curves, so the first frame after Halation was turned on read empty curves. `pass` now activates the placeholder's own unit first:

```js
for (const [k, u] of Object.entries(P.u)) {
  if ((u.type !== gl.SAMPLER_2D && u.type !== gl.SAMPLER_3D) || (texs[k] && P.u[k])) continue;
  const is3 = u.type === gl.SAMPLER_3D;
  gl.activeTexture(gl.TEXTURE0 + unit);   // first: making the placeholder binds it to the active unit
  gl.bindTexture(is3 ? gl.TEXTURE_3D : gl.TEXTURE_2D, this.placeholder(is3)); gl.uniform1i(u.loc, unit); unit++;
}
```

Rendering the same settings twice and comparing found the second bug at once. WebGPU removes this class of error: a pass declares all its resources in a bind group.

**Timing a GPU.** A draw call returns as soon as it is queued, and `gl.finish()`, meant to wait for the GPU, does not wait in Chromium: a default frame timed with it took 0.5 ms, and the same frame timed by reading back one texel took 652 ms (1,410 ms with every operator on; 0.8 ms with `finish`). A read-back is ordered after every queued draw that writes what it reads, so it is a reliable wait. `sync` in `render.js` reads one texel of the output target after each frame, and the Studio's displayed render time is measured to that point.

## 4.5 Compute shaders: the dye solve on the GPU

**WebGPU** exposes the GPU for general computation through **compute shaders** written in WGSL: a shader runs once per **invocation**, invocations come in **workgroups** of a declared size, a **dispatch** launches a grid of workgroups, and unlike a fragment shader an invocation reads and writes arbitrary buffers and shares a small, fast **workgroup memory** with its group. `gpu.js` has two kernels, both with one invocation per table node and 64 invocations per workgroup (`WG`), so a table is one dispatch of ⌈35,937/64⌉=562\\lceil 35{,}937/64\\rceil = 562 workgroups:

- `SOLVE` runs the bounded Levenberg–Marquardt solve of `solve.js` ([Chapter 3](#ch-3)) in 32-bit floats, residual and closed-form Jacobian from one loop over the spectrum;
- `SPECTRAL` sums ∑λWk(λ) 10−(b+∑jcjεj)\\sum\_\\lambda W_k(\\lambda)\\,10^{-(b + \\sum_j c_j\\varepsilon_j)} and returns −log⁡10-\\log\_{10} of it (printing density) or a 3 × 3 matrix times it (the print's XYZ).

**Shared inputs in workgroup memory.** Every invocation loops over the same seven spectra (three channel weights, three dyes and the base, 81 samples each), so each workgroup first copies them into `var<workgroup> sh: array<f32, 896>` (room for 128 samples, 3,584 bytes; the adapter here offered 16,384), each invocation copying every 64th value, then waits at a barrier:

```wgsl
for (var i = li; i < 7u * U.n; i += WG) { sh[i] = spec[i]; }
workgroupBarrier();
let q = gid.x;
if (q >= U.total) { return; }
```

The order matters: the last workgroup has 31 invocations past the end of the table, and they must still reach the barrier, which every invocation of a group must execute. WGSL checks this statically as **uniform control flow**: given a kernel that returns on `gid.x` before its barrier, Chromium's compiler refuses it with "'workgroupBarrier' must only be called from uniform control flow" and the note "builtin 'g' of 'main' may be non-uniform" (`wgsl-probe.cjs`). The same probe shows another trap of a young language: WGSL reserves many identifiers for future use, and `let active = 1u;` fails with "'active' is a reserved keyword" (as do `filter` and `target`); the kernel names its mask of held dyes `act`.

**Divergence.** The invocations of a group run in lockstep on most GPUs, so a group takes as long as its slowest member, and an iterative solve does a different number of iterations at every node. With the original clipped step the counts within a group of 64 consecutive nodes spread by 45 on average: nodes outside the film's gamut crept along a bound to the 50-iteration cap while their neighbours finished in two. The active-set step of [Chapter 3](#ch-3) cut the mean from 13.9 to 2.3 iterations on the CPU and the spread to about one. On the GPU I counted iterations with a copy of the kernel that writes them out: mean 2.04, at most 9, and a **lockstep ratio** (the sum over groups of 64 × the group's largest count, divided by the total count) of 1.26, so lockstep wastes a fifth of the work. Branches that differ between invocations cost both sides, so the kernel expresses per-dye choices with `select`, which picks per component without branching. Where `solve.js` writes `if (a0) { b00 = 1; A01 = 0; A02 = 0; }` for each held dye, the kernel masks whole columns:

```wgsl
let m = select(vec3<f32>(1.0), vec3<f32>(0.0), act);   // 1 for a free dye, 0 for a held one
b = mat3x3<f32>(b[0] * m * m.x, b[1] * m * m.y, b[2] * m * m.z)
  + mat3x3<f32>(vec3<f32>(1.0 - m.x, 0.0, 0.0), vec3<f32>(0.0, 1.0 - m.y, 0.0), vec3<f32>(0.0, 0.0, 1.0 - m.z));
```

**Tolerances for 32-bit floats.** A 32-bit float carries 24 significant bits, a relative spacing of 6×10−86\\times10^{-8}. The residual is −log⁡10-\\log\_{10} of a sum of 81 terms, so it is known to about 10−710^{-7}, and so is the gradient J⊤rJ^\\top\\mathbf r. The CPU stops when the projected gradient falls below 10−910^{-9}, a test that in 32-bit arithmetic almost never fires; the solve then ends only when twelve damped trial steps all fail to lower the residual, each costing a pass over the spectrum. `gpuSolve` therefore raises the tolerance to at least 10−610^{-6}. To see what that buys I ported the kernel to JavaScript with every operation rounded to 32 bits (`f32solve.cjs`, `Math.fround`): with 10−610^{-6} it makes 6.49 passes over the spectrum per node, with 10−910^{-9} 8.55 (32 % more, and a lockstep ratio of 1.43), and with 10−510^{-5} 5.70 passes but errors 6.5 times larger. Figure 4.4 shows the result on the 27,000 nodes that the CPU solve reaches: the WGSL kernel on SwiftShader differs from the 64-bit table by at most 2.18×10−62.18\\times10^{-6} in dye amount, and the port by 2.21×10−62.21\\times10^{-6}. The spectral kernels differ by at most 7.2×10−77.2\\times10^{-7} in printing density and 4.2×10−74.2\\times10^{-7} in XYZ.

**Figure 4.4.** Left: the largest difference in dye amount per node between 32-bit and 64-bit solves, on the 27,000 nodes of the 33³ solve table that the 64-bit solve reaches, in half-decade bins: the WGSL kernel of `gpu.js` run on Chromium's WebGPU with SwiftShader (red), and the 32-bit JavaScript port with the GPU's tolerance 10−610^{-6} (dashed) and with 10−510^{-5} (dotted). Right: the 64-bit residual of all 35,937 nodes (residuals below 10−810^{-8} are counted in the first bin); no node lies between 7.6×10−47.6\\times10^{-4} and 0.047, so no node is near the 0.01 threshold (`gpu-run.cjs`, `f32solve.cjs`, `fig4.cjs`; scanner xt5-fitted, Kodak Gold 200; film data: spektrafilm, CC BY-SA 4.0).

**Compile, dispatch, read back.** `pipeline` compiles each kernel once per device and turns WGSL errors into exceptions that name the line, so a broken kernel falls back to the workers. The software adapter compiled each kernel in 0.2 to 0.37 s and ran the solve with its `mapAsync` read-back in 0.30 to 0.39 s (0.66 s inside the app's benchmark), slower than two workers; `Accel.order` therefore uses WebGPU under *Auto* only on a hardware adapter.

**Try it.** Open [the 32-bit solve sketch](#bench-04-making-it-fast). Its first node lies outside the film's gamut. Lower gtol from 1e-6 to 1e-9: the 64-bit gradient keeps falling, the 32-bit one stops near 10−710^{-7}, and the 32-bit solve ends only after twelve failed trial steps, 17 passes over the spectrum instead of 5, with the same answer. Then set a₁ to 1.0, a reachable node, and watch the two residuals part near 10−710^{-7}.

## 4.6 Many cores: a pool of workers

The table nodes are independent, so they parallelise without coordination. JavaScript runs one thread per page; **Web Workers** add threads with their own memory, which talk to the page by messages. `accel.js` and `worker.js` build the three tables in a pool of min⁡(8,cores)\\min(8, \\text{cores}) workers:

- **Shipping code.** The worker is a second bundle of the engine, carried in the page as the text of a script element (id `st-worker`) and started from a `blob:` URL (`Pool.start`), so a single-file page can start workers. Each worker receives the engine's data once and rebuilds scanner, film and paper from their names with the page's own `model.js` code (`once` in `worker.js`).
- **Dynamic scheduling.** `Pool.run` cuts a table into ranges of 512 nodes for the solve and 2,048 for the others, puts them on one queue, and `pump` hands the next range to whichever worker is idle. Jobs marked urgent (the two short tables) go to the front of the queue so they are not stuck behind a long solve.
- **Transfer, not copy.** A worker posts its `Float32Array` with its buffer in the transfer list, which moves ownership to the page without copying; `done` writes it into the table at `q0 * 4`.

Why a shared queue rather than one contiguous range per worker: the nodes are not equally hard. I timed each of the 71 solve ranges in node and simulated both schedules (`schedule.cjs`):

| Solve | Σ of ranges | 2 workers: queue / static | 8 workers: queue / static / ideal |
| --- | --- | --- | --- |
| active-set step (the Studio) | 293 ms | 147 / 163 ms | 38 / 49 / 37 ms |
| clipped step (before) | 1,728 ms | 869 / 1,062 ms | 231 / 640 / 216 ms |

With the old solver the hard nodes clustered in a few ranges (one took 97.5 ms), and a static split at 8 workers would have been three times slower than the queue. In the browser the two workers built the solve table in 154 ms against 365 ms on the main thread, which also yields to the page every 30 ms (`solveTable`, `budgetMs`). The workers run the same code on the same 64-bit floats as the page, so their tables are bitwise equal to the main thread's.

Uneven work per element is common in image code. spektrafilm's `fast_stats.py` draws grain counts per pixel in a numba `prange` loop: Poisson variates by Knuth's product of uniforms below λ = 30, which costs about λ + 1 random numbers, and a rounded normal above, which costs one but is only approximate (total-variation distance 0.023 from Poisson(30), variance λ + 1/12, computed with SciPy); binomial variates switch between direct simulation, inversion and a normal approximation the same way. A parallel loop over such elements wants chunks small enough to balance.

## 4.7 Proving that the fast path computes the slow path

Every speed-up here replaces one computation by another and needs a check against the slower one. `Accel.benchmark` builds the three tables on every backend, compares each node with the main thread's table, and for the solve counts **flips**, nodes whose residual lands on the other side of the 0.01 threshold. I reran the Studio's checks (`studio-bench.cjs`, after `test/accel.cjs` and `test/export.cjs`):

| Check | Measured now | Write-up |
| --- | --- | --- |
| workers against main thread, all three tables | bitwise equal | bitwise equal |
| GPU solve, max ∣Δc∣\\lvert\\Delta c\\rvert on reachable nodes; flips | 2.15×10−62.15\\times10^{-6}; 0 | 2.2×10−62.2\\times10^{-6}; 0 |
| GPU printing density; print XYZ | 7.2×10−77.2\\times10^{-7}; 4.2×10−74.2\\times10^{-7} | 7×10−77\\times10^{-7}; – |
| print rendered from workers' or GPU tables | identical in every 8-bit value | identical |
| tiled export, 256-px tiles with 8-px halo, against one pass | mean 0.0004, max 1 level | max 1 level |
| the same without a halo | mean 0.017, max 28 levels | – |

A tolerance should come from the arithmetic, not from what happened to pass: 32-bit rounding of a residual near 10−710^{-7} bounds the GPU solve's disagreement at a few 10−610^{-6}, which kernel and port both show, and an 8-bit output allows one level, because two correct pipelines can round a boundary value differently.

A check must also be able to fail. The flip count is zero on every backend, but Figure 4.4 shows why that proves little: the nodes' residuals have a gap from 7.6×10−47.6\\times10^{-4} to 0.047, so no plausible error moves a node across 0.01. Pixels between nodes are different: interpolating the residual channel put 186 of 20,000 random keys on the wrong side (§4.2). The informative test is therefore at random keys between nodes, or on a real frame, which is what the print comparison does. The tile test is a good design for the same reason: without a halo it fails loudly (max 28 levels at the seams), so its pass with an 8-px halo means something. The halo must cover the widest per-pixel neighbourhood, 2 px for grain reduction and Texture; the wide fields (bases, halation, bloom) are not recomputed per tile but read from the one global pass through the tile's position in the frame (the `g2` uniform), so they cannot seam.

**Try it.** Open [the tile-seams sketch](#bench-04-making-it-fast). With no halo the tiled blur is off by up to 13 levels along the tile edges; set the halo to the blur radius, 4 px, and the error is 0, at the cost of 17 % more pixels computed. Then raise the halo to 8 and turn the wide field on *per tile*: 20 levels of error, because a σ = 16 kernel reads far beyond any halo; read it from the *global* pass instead and the error is 0 again.

In short: keep a slow reference, test where the paths could disagree (between nodes, at the edge of the reachable set, at seams, on the first frame after a state change), state the tolerance first, and check that the test fails when the fast path is broken.

## 4.8 Rules that hold beyond this program

For shaders, GLSL and WGSL alike:

- Cut passes only where the next step reads neighbours; fuse everything else, since each cut writes and rereads a full target.
- Fold every per-frame constant into uniforms or the shader text, and every per-stock function into a table (the print table folds the observer, the white and the Bradford adaptation, which is linear once both whites are fixed).
- Loop to the kernel's own radius with weights from a uniform array, never to a constant bound with `continue`.
- Write 10x10^x as `exp2(3.3219281 * x)` and log⁡10\\log\_{10} as `log2(x) * 0.30103`. `gpu.js` does; `shaders.js` still writes `pow(vec3(10.0), x)` and `log(…) / log(10.0)`, which the write-up advises against.
- Branch on uniforms freely; for per-pixel or per-node choices prefer `mix`, `step`, `clamp` and `select`.
- In compute shaders, keep shared inputs in workgroup memory, put barriers before any early return, and keep the work per invocation even, since a group runs as long as its slowest member.
- Time GPU work by reading back one texel, not with `gl.finish()`, and bind every sampler on every draw.

For JavaScript:

- Measure in the engine you ship. `Math.pow(10, x)` cost 45 ns in node 22 against 16 ns for `Math.exp(Math.LN10 * x)`, and rewriting `pdOf` that way made the printing-density table 3.3 times faster with a bitwise-identical result; in Chromium 153 the gap was only 1.4 times, which is why the Studio's own benchmark measures that table at 53 ms and node at 113 ms.
- Keep hot loops allocation-free over typed arrays, as `solve.js` does with its residual and Jacobian.
- Warm up before timing: the recursive blur took 26 ms on its first calls, 4 ms once optimised.
- Precompute tables for bit-level loops (the CRC in `export.js`) and reciprocals for inner-loop divisions (`fast_interp.py`).
- Use 64-bit accumulators where sums grow with the image (summed-area tables), even when the data are 32-bit.

## 4.9 Toward a reusable API

The chapter's techniques reduce to a small vocabulary:

```text
// a table of f over the box [lo, hi]³ with N nodes per axis, built by any backend
buildTable(f, { N, lo, hi, backend })            // → { N, range, data: Float32Array(N³ · 4) }
lookup(T, key, mode = 'trilinear')               // → value; mode 'tetrahedral' reads 4 nodes instead of 8
tableError(T, f, sampleKeys)                     // → { rms, max, flips } against exact evaluation
key(...inputs)                                   // → string that changes whenever any input that changes the output does
blur(src, sigma, { method, truncate = 3 })       // method: 'separable' | 'boxes' | 'recursive' | 'fft'
runParallel(nodes, chunk, worker, { urgent })    // → Float32Array, ranges from one shared queue
compare(fast, slow, { tolerance, threshold })    // → { maxDiff, flips } with flips across a decision threshold
```

Laws that make good unit tests:

- `lookup(buildTable(f), x)` equals `f(x)` at every node, and for smooth ff its error at mid-cell falls by four when N−1N - 1 doubles.
- `buildTable(f, { backend: 'workers' })` equals `buildTable(f, { backend: 'main' })` bitwise; the GPU backend agrees within the 32-bit tolerance stated before the run.
- Rendering in tiles with a halo at least the widest kernel's radius equals rendering in one pass within one output level, and the same test without a halo fails.
- Two caches entries with different `key`s never alias, and changing any input changes the key.

## Code in this chapter

| Module | What it computes | Section |
| --- | --- | --- |
| `studio-app/src/model.js` | the three 33³ tables and 1-D curves, their keys and domains, node ranges for every backend, `look3` | 4.1, 4.2 |
| `studio-app/src/render.js` | WebGL2 passes, render targets, sampler binding, `blurKernel`, `sync`, tiled export, half floats | 4.2–4.4, 4.7 |
| `studio-app/src/shaders.js` | the GLSL passes: `lut3`, `FS_BLUR`, dyes, printing density, print, output | 4.2–4.4 |
| `studio-app/src/gpu.js` | WGSL kernels for the solve and spectral tables, uniform packing, compile and dispatch | 4.5 |
| `studio-app/src/accel.js` | backend choice and fallback, the worker pool and its queue, the benchmark | 4.5–4.7 |
| `studio-app/src/worker.js` | a worker that fills node ranges and transfers them | 4.6 |
| `studio-app/src/export.js` | PNG, TIFF and zip writers with a table-driven CRC-32 | 4.1 |
| `studio-app/content/book/11-speed.md` | the Studio's own account; numbers rechecked here | all |
| `spektrafilm/utils/lut.py` | tables built by evaluating a function on a grid | 4.2 |
| `spektrafilm/utils/fast_interp_lut.py` | PCHIP and Mitchell 3-D interpolation | 4.2 |
| `spektrafilm/utils/fast_interp.py` | 1-D interpolation on uneven axes | 4.2 |
| `spektrafilm/utils/fast_gaussian_filter.py` | fused separable and recursive Gaussian blurs | 4.3 |
| `spektrafilm/utils/fft_gaussian_filter.py` | Gaussian blur by FFT | 4.3 |
| `spektrafilm/utils/fast_stats.py` | parallel Poisson, binomial and lognormal variates | 4.6 |
| `spektrafilm/utils/numba_boost_hightlights.py` | the highlight boost, constants hoisted out of the pixel loop | 4.1 |
| `spektrafilm/utils/numba_warmup.py` | compiles every kernel at start-up | 4.1 |
| `spektrafilm/runtime/services/spectral_lut_compute.py` | cached enlarger and scanner tables, validated by probes | 4.1 |

## Exercises

1. Two minutes: how many reads per pixel does the Studio's halation blur make at 640 px (σ\\sigma = 1.8 % of the long side, the wider of its two kernels), as a 2-D kernel, as `FS_BLUR` makes them, and with bilinear taps?
2. Using the error formula of §4.2 and Figure 4.1, choose the smallest NN for which the solve table's rms error in smooth cells is below 10−410^{-4}, and give its size in bytes as RGBA32F and RGBA16F.
3. Fix spektrafilm's LUT cache: add the domain to the probe test in `spectral_compute_enlarger`, and write the unit test from §4.9 that would have caught the stale table.
4. Measure the Young–van Vliet blur's effective σ\\sigma for σ\\sigma from 3 to 50 and fit a correction q(σ)q(\\sigma) that makes it exact; report the largest remaining error against a sampled Gaussian.
5. Project: implement tetrahedral interpolation in a fragment shader with four unfiltered fetches and compare its speed and error with the hardware trilinear fetch on the Gold 200 frame.

## Sketches in this chapter

4 sketches; choose one from the menu. Drag the parameters, or open the source and edit it: edits stay in this browser.

## Key points

- Place each computation at the binding time of its inputs: per stock, per scan, per change of settings, per pixel.
- A function of three numbers that is fixed per stock becomes a 33³ table, read with one filtered texture fetch.
- Trilinear interpolation errs by h22∑ti(1−ti) ∂2f/∂ai2\\tfrac{h^2}{2}\\sum t_i(1-t_i)\\,\\partial^2 f/\\partial a_i^2 where the function is smooth, and only O(h)O(h) across kinks such as the edge of a film's gamut.
- A cache is correct only if its key contains every input that changes the output; a scan's identity and a table's domain are inputs.
- Separable kernels, reduced resolution, summed-area tables, recursive filters and FFTs each lower a blur's cost; on a GPU the separable kernel at reduced resolution fits best.
- A fragment shader is a map over pixels; cut passes only where neighbours are needed, bind every sampler on every draw, and time with a read-back.
- On a GPU, iterative per-node work should keep its iteration counts even, and its tolerances must sit above 32-bit rounding.
- A shared queue of small ranges keeps workers busy when work per node varies.
- A check is worth running only if it could fail: choose inputs where the fast and slow paths could disagree, and state the tolerance first.

## Further reading

Classic references cited in the text but not opened for this chapter (Kasson et al. 1995 on tetrahedral interpolation, Crow 1984 on summed-area tables, Young and van Vliet 1995 on recursive Gaussians, NVIDIA's CUDA guide on filtering precision) are identified where they are cited. The sources below were read for it.

- `studio-app/content/book/11-speed.md`: the Studio's own account of this work, whose numbers §4.3–4.7 recheck.
- `studio-app/test/accel.cjs` and `export.cjs`: the benchmark and the tile test as the Studio runs them, rerun in §4.7.
- `chromogen/src/solve.js`: the 64-bit solve that the WGSL kernel of §4.5 transcribes, and its stopping rules.
- `studio-app/src/source.js`, `sigmaD` and `Source.working`: the summed-area tables of §4.3 and the cache key of §4.1.
- spektrafilm, `utils/fast_interp_lut.py`, `fast_gaussian_filter.py`, `fft_gaussian_filter.py` and `runtime/services/spectral_lut_compute.py`: the CPU counterparts, with the discrepancies §4.1–4.3 measure.
- E. J. Giorgianni and T. E. Madden, *Digital Color Management*, 2nd ed. (Wiley, 2008), Appendix I: when to use 1-D tables, 3-D tables and matrices.
- *Colour Negatives from First Principles*, Chapter 9 (`09-dye-solve.md`, §9.7): the solve table keyed on the tangent solve, whose factor of three §4.2 compares with.

Set in the Kiln design system. Maths rendered to MathML with KaTeX at build time; figures computed by the scripts in `work/`; sketches run in the page. Film and paper data: spektrafilm (A. Volpato), CC BY-SA 4.0. Written by four writers in parallel by the method of the Executable Textbook Handbook; their diaries are in the archive. Built 2026-11-10.